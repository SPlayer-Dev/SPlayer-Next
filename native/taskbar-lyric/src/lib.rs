//! Windows 任务栏歌词原生模块
//! 通过 NAPI-RS 暴露给 Node.js，将 Electron BrowserWindow 嵌入 Windows 任务栏

use std::{
    ffi::c_void,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
};

use napi::{
    Status,
    bindgen_prelude::Function,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;

type LayoutTsfn = ThreadsafeFunction<JsTaskbarLayout, UnknownReturnValue, JsTaskbarLayout, Status, false>;
type VoidTsfn = ThreadsafeFunction<(), UnknownReturnValue, (), Status, false>;
use strategy::{LayoutParams, LegacyStrategy, TaskbarStrategy, Win11Strategy};
use utils::get_windows_build_number;
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, HWND, WAIT_OBJECT_0},
        System::{
            Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize},
            Registry::{
                HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RegCloseKey,
                RegNotifyChangeKeyValue, RegOpenKeyExW,
            },
            Threading::{CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects},
        },
    },
    core::w,
};

/// 任务列表和歌词之间的微小间距
pub const GAP: i32 = 10;

#[macro_use]
mod logger;
mod strategy;
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
            },
        }
    }
}

// --- TaskbarService ---

enum TaskbarCommand {
    Embed { hwnd_ptr: usize },
    Update { width: i32 },
    Stop,
}

#[napi]
pub struct TaskbarService {
    sender: Sender<TaskbarCommand>,
}

#[napi]
impl TaskbarService {
    #[napi(
        constructor,
        ts_args_type = "callback: (layout: JsTaskbarLayout) => void"
    )]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<JsTaskbarLayout, UnknownReturnValue>,
    ) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<JsTaskbarLayout>()
            .build_callback(|ctx| Ok(ctx.value))?;

        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            worker_loop(&rx, &tsfn);
        });

        Ok(Self { sender: tx })
    }

    /// 嵌入窗口到任务栏。传入 Electron BrowserWindow 的 native handle (Buffer → usize)
    #[napi]
    pub fn embed_window_by_ptr(&self, hwnd_ptr: f64) {
        let _ = self.sender.send(TaskbarCommand::Embed {
            hwnd_ptr: hwnd_ptr as usize,
        });
    }

    /// 更新歌词显示宽度，触发重新计算布局
    #[napi]
    pub fn update(&self, lyric_width: i32) {
        let _ = self.sender.send(TaskbarCommand::Update {
            width: lyric_width,
        });
    }

    /// 停止服务并恢复任务栏原始状态
    #[napi]
    pub fn stop(&self) {
        let _ = self.sender.send(TaskbarCommand::Stop);
    }
}

fn worker_loop(
    rx: &Receiver<TaskbarCommand>,
    tsfn: &LayoutTsfn,
) {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() {
            return;
        }
    }

    let mut strategy = create_strategy();

    while let Ok(msg) = rx.recv() {
        match msg {
            TaskbarCommand::Embed { hwnd_ptr } => {
                let hwnd = HWND(hwnd_ptr as *mut c_void);
                if let Some(s) = strategy.as_ref() {
                    s.embed_window(hwnd);
                }
            }

            TaskbarCommand::Update { width } => {
                let mut final_width = width;
                let mut stop_signal = false;

                while let Ok(next_msg) = rx.try_recv() {
                    match next_msg {
                        TaskbarCommand::Update { width: w } => final_width = w,
                        TaskbarCommand::Embed { hwnd_ptr } => {
                            let hwnd = HWND(hwnd_ptr as *mut c_void);
                            if let Some(s) = strategy.as_ref() {
                                s.embed_window(hwnd);
                            }
                        }
                        TaskbarCommand::Stop => {
                            stop_signal = true;
                            break;
                        }
                    }
                }

                if stop_signal {
                    break;
                }

                if let Some(s) = strategy.as_mut() {
                    let params = LayoutParams {
                        lyric_width: final_width,
                    };
                    if let Some(layout) = s.update_layout(params) {
                        let js_layout: JsTaskbarLayout = layout.into();
                        tsfn.call(js_layout, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                }
            }

            TaskbarCommand::Stop => {
                break;
            }
        }
    }

    if let Some(s) = strategy.as_ref() {
        s.restore();
    }
    unsafe {
        CoUninitialize();
    }
}

fn create_strategy() -> Option<Box<dyn TaskbarStrategy>> {
    let build_num = get_windows_build_number();

    let (mut primary, mut secondary): (Box<dyn TaskbarStrategy>, Box<dyn TaskbarStrategy>) =
        if build_num >= 22000 {
            (
                Box::new(Win11Strategy::new()),
                Box::new(LegacyStrategy::new()),
            )
        } else {
            (
                Box::new(LegacyStrategy::new()),
                Box::new(Win11Strategy::new()),
            )
        };

    if primary.init() {
        return Some(primary);
    }

    if secondary.init() {
        return Some(secondary);
    }

    None
}

// --- RegistryWatcher ---

struct EventHandle(HANDLE);

impl Drop for EventHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

unsafe impl Send for EventHandle {}
unsafe impl Sync for EventHandle {}

#[napi]
pub struct RegistryWatcher {
    stop_event: Arc<EventHandle>,
    is_running: Arc<AtomicBool>,
}

#[napi]
impl RegistryWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<(), UnknownReturnValue>,
    ) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<()>()
            .build_callback(|_ctx| Ok(()))?;

        let raw_event = unsafe { CreateEventW(None, true, false, None) }
            .map_err(|e| napi::Error::from_reason(format!("创建停止事件失败: {e}")))?;

        let stop_event = Arc::new(EventHandle(raw_event));
        let is_running = Arc::new(AtomicBool::new(true));
        let thread_event = stop_event.clone();

        thread::spawn(move || unsafe {
            registry_watch_loop(&thread_event, &tsfn);
        });

        Ok(Self {
            stop_event,
            is_running,
        })
    }

    #[napi]
    pub fn stop(&self) {
        if !self.is_running.load(Ordering::SeqCst) {
            return;
        }

        unsafe {
            let _ = SetEvent(self.stop_event.0);
        }

        self.is_running.store(false, Ordering::SeqCst);
    }
}

unsafe fn registry_watch_loop(
    stop_event_wrapper: &Arc<EventHandle>,
    tsfn: &VoidTsfn,
) {
    let stop_event = stop_event_wrapper.0;

    let mut h_key = HKEY::default();
    let sub_key = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced");

    unsafe {
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            sub_key,
            Some(0),
            KEY_NOTIFY,
            &raw mut h_key,
        )
        .is_err()
        {
            return;
        }

        let reg_event = match CreateEventW(None, false, false, None) {
            Ok(evt) => evt,
            Err(_) => {
                let _ = RegCloseKey(h_key);
                return;
            }
        };

        loop {
            let notify_res = RegNotifyChangeKeyValue(
                h_key,
                true,
                REG_NOTIFY_CHANGE_LAST_SET,
                Some(reg_event),
                true,
            );

            if notify_res.is_err() {
                break;
            }

            let handles = [stop_event, reg_event];
            let wait_result = WaitForMultipleObjects(&handles, false, INFINITE);

            let index = wait_result.0.wrapping_sub(WAIT_OBJECT_0.0);

            match index {
                0 => break,
                1 => {
                    tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
                }
                _ => break,
            }
        }

        let _ = CloseHandle(reg_event);
        let _ = RegCloseKey(h_key);
    }
}

// --- NapiUiaWatcher ---

#[napi(js_name = "UiaWatcher")]
pub struct NapiUiaWatcher {
    inner: uia_watcher::UiaWatcher,
}

#[napi]
impl NapiUiaWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<(), UnknownReturnValue>,
    ) -> napi::Result<Self> {
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

// --- NapiTrayWatcher ---

#[napi(js_name = "TrayWatcher")]
pub struct NapiTrayWatcher {
    inner: tray_watcher::TrayWatcher,
}

#[napi]
impl NapiTrayWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<(), UnknownReturnValue>,
    ) -> napi::Result<Self> {
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
