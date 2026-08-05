//! Windows 任务栏歌词原生模块
//! 通过 NAPI-RS 暴露给 Node.js，将 Electron BrowserWindow 嵌入 Windows 任务栏

use std::ffi::c_void;

use napi::{
    bindgen_prelude::Function,
    threadsafe_function::{ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;
use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::IsWindow};

/// 任务列表和歌词之间的微小间距
pub const GAP: i32 = 10;

#[macro_use]
mod logger;
mod registry_watcher;
mod service;
mod strategy;
mod taskbar_created_watcher;
mod tray_watcher;
mod uia;
mod uia_watcher;
mod utils;

// --- NAPI 数据类型 ---

#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsAvailableSpace {
    pub left: JsRect,
    pub right: JsRect,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsExtraLayoutInfo {
    /// "win10" | "win11"
    pub system_type: String,
    pub is_centered: bool,
    /// 任务栏是否为浅色主题
    pub is_light: bool,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsTaskbarLayout {
    pub space: JsAvailableSpace,
    pub extra: JsExtraLayoutInfo,
}

impl From<strategy::TaskbarLayout> for JsTaskbarLayout {
    fn from(layout: strategy::TaskbarLayout) -> Self {
        Self {
            space: JsAvailableSpace {
                left: JsRect {
                    x: layout.space.left.x,
                    y: layout.space.left.y,
                    width: layout.space.left.width,
                    height: layout.space.left.height,
                },
                right: JsRect {
                    x: layout.space.right.x,
                    y: layout.space.right.y,
                    width: layout.space.right.width,
                    height: layout.space.right.height,
                },
            },
            extra: JsExtraLayoutInfo {
                system_type: match layout.extra.system_type {
                    strategy::SystemType::Win10 => "win10".to_string(),
                    strategy::SystemType::Win11 => "win11".to_string(),
                },
                is_centered: layout.extra.is_centered,
                is_light: layout.extra.is_light,
            },
        }
    }
}

/// JS 侧传来的 hwnd_ptr 转 HWND，并用 `IsWindow` 校验。
///
/// JS 通常给的是 Electron BrowserWindow.getNativeWindowHandle()，绝大多数情况有效；
/// 但窗口已 destroyed / JS 传错指针时拿到的就是无效句柄，继续传给 Win32 API 行为未定义
pub(crate) fn take_valid_hwnd(hwnd_ptr: usize) -> Option<HWND> {
    let hwnd = HWND(hwnd_ptr as *mut c_void);
    // SAFETY: IsWindow 接受任意指针，对非法值返回 false 而非崩溃
    if unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        Some(hwnd)
    } else {
        warn!("无效 HWND (0x{hwnd_ptr:x})，跳过");
        None
    }
}

/// 从 Electron 原始句柄 Buffer 读取平台宽度的 HWND。
pub(crate) fn hwnd_from_buffer(buffer: &[u8]) -> Option<usize> {
    let width = size_of::<usize>();
    if buffer.len() != width {
        return None;
    }
    if width == 8 {
        usize::try_from(u64::from_le_bytes(buffer.try_into().ok()?)).ok()
    } else {
        usize::try_from(u32::from_le_bytes(buffer.try_into().ok()?)).ok()
    }
}

// --- NAPI Watcher 绑定 ---

#[napi(js_name = "UiaWatcher")]
pub struct NapiUiaWatcher {
    inner: uia_watcher::UiaWatcher,
}

#[napi]
impl NapiUiaWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(callback: Function<(), UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<()>()
            .build_callback(|_ctx| Ok(()))?;

        let inner = uia_watcher::UiaWatcher::new(Box::new(move || {
            tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self { inner })
    }

    #[napi]
    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[napi(js_name = "TrayWatcher")]
pub struct NapiTrayWatcher {
    inner: tray_watcher::TrayWatcher,
}

#[napi]
impl NapiTrayWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(callback: Function<(), UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<()>()
            .build_callback(|_ctx| Ok(()))?;

        let inner = tray_watcher::TrayWatcher::new(Box::new(move || {
            tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self { inner })
    }

    #[napi]
    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[napi(js_name = "TaskbarCreatedWatcher")]
pub struct NapiTaskbarCreatedWatcher {
    inner: taskbar_created_watcher::TaskbarCreatedWatcher,
}

#[napi]
impl NapiTaskbarCreatedWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(callback: Function<(), UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<()>()
            .build_callback(|_ctx| Ok(()))?;

        let inner = taskbar_created_watcher::TaskbarCreatedWatcher::new(Box::new(move || {
            tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self { inner })
    }

    #[napi]
    pub fn stop(&mut self) {
        self.inner.stop();
    }
}
