//! Windows 任务栏歌词原生模块
//! 通过 NAPI-RS 暴露给 Node.js，将 Electron BrowserWindow 嵌入 Windows 任务栏

use std::{
    ffi::c_void,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread,
    time::Duration,
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
    core::HSTRING,
};

/// 任务列表和歌词之间的微小间距
pub const GAP: i32 = 10;

#[macro_use]
mod logger;
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

// --- TaskbarService ---

enum TaskbarCommand {
    Embed { hwnd_ptr: usize },
    Update { width: i32 },
    /// explorer 重启后重新初始化策略并用最近的 hwnd/width 恢复
    Reinit,
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

    /// 通知服务重建策略（explorer.exe 重启时由 JS 层调用）
    #[napi]
    pub fn reinit(&self) {
        let _ = self.sender.send(TaskbarCommand::Reinit);
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
    // 记忆最近的 hwnd/width，explorer 重启后 Reinit 据此恢复
    let mut last_hwnd: Option<usize> = None;
    let mut last_width: i32 = 0;

    while let Ok(msg) = rx.recv() {
        match msg {
            TaskbarCommand::Embed { hwnd_ptr } => {
                last_hwnd = Some(hwnd_ptr);
                let hwnd = HWND(hwnd_ptr as *mut c_void);
                if let Some(s) = strategy.as_ref() {
                    s.embed_window(hwnd);
                }
            }

            TaskbarCommand::Update { width } => {
                let mut final_width = width;
                let mut stop_signal = false;
                let mut reinit_requested = false;

                while let Ok(next_msg) = rx.try_recv() {
                    match next_msg {
                        TaskbarCommand::Update { width: w } => final_width = w,
                        TaskbarCommand::Embed { hwnd_ptr } => {
                            last_hwnd = Some(hwnd_ptr);
                            let hwnd = HWND(hwnd_ptr as *mut c_void);
                            if let Some(s) = strategy.as_ref() {
                                s.embed_window(hwnd);
                            }
                        }
                        TaskbarCommand::Reinit => {
                            reinit_requested = true;
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

                last_width = final_width;

                if reinit_requested {
                    do_reinit(&mut strategy, last_hwnd);
                }

                if !run_update_with_retry(&mut strategy, final_width, tsfn, rx) {
                    break;
                }
            }

            TaskbarCommand::Reinit => {
                do_reinit(&mut strategy, last_hwnd);
                if last_width > 0 && !run_update_with_retry(&mut strategy, last_width, tsfn, rx) {
                    break;
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

/// Drop 旧策略（自动 restore），新建策略并用最近的 hwnd 重新嵌入。
fn do_reinit(strategy: &mut Option<Box<dyn TaskbarStrategy>>, last_hwnd: Option<usize>) {
    debug!("TaskbarCreated → 重建策略");
    *strategy = None;
    *strategy = create_strategy();
    if let (Some(s), Some(hwnd_ptr)) = (strategy.as_ref(), last_hwnd) {
        let hwnd = HWND(hwnd_ptr as *mut c_void);
        s.embed_window(hwnd);
    }
}

/// 对 `update_layout` 做有界退避重试，专门兜底 UIA 冷启动首次扫描返回 None 的情形。
///
/// 重试窗口累计约 1.1s：第一次立即尝试，之后分别等 50/150/300/600ms；
/// 每次等待都用 `recv_timeout` 可被新命令打断（新 Update 改宽度、Embed 继续嵌入、Stop 退出）。
///
/// 注意：`update_layout` 返回 `Some(layout)`（含"两侧空间都 0"这种合法的"无空间"情况）会立即 emit 并返回——
/// 这种是真·无位置展示，不该被当成失败；只有真·扫描失败（UIA 树冷启拿不到内容）才会走重试。
///
/// 返回 false 表示接收到 Stop，上层应退出 worker_loop。
fn run_update_with_retry(
    strategy: &mut Option<Box<dyn TaskbarStrategy>>,
    initial_width: i32,
    tsfn: &LayoutTsfn,
    rx: &Receiver<TaskbarCommand>,
) -> bool {
    const DELAYS_MS: &[u64] = &[0, 50, 150, 300, 600];
    let mut current_width = initial_width;

    for &delay_ms in DELAYS_MS {
        if delay_ms > 0 {
            match rx.recv_timeout(Duration::from_millis(delay_ms)) {
                Ok(TaskbarCommand::Update { width }) => current_width = width,
                Ok(TaskbarCommand::Embed { hwnd_ptr }) => {
                    let hwnd = HWND(hwnd_ptr as *mut c_void);
                    if let Some(s) = strategy.as_ref() {
                        s.embed_window(hwnd);
                    }
                }
                Ok(TaskbarCommand::Reinit) => {
                    // 重试期间 explorer 重启，策略彻底重建，退出本轮重试由外层走新一轮
                    return true;
                }
                Ok(TaskbarCommand::Stop) => return false,
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }

        if let Some(s) = strategy.as_mut() {
            let params = LayoutParams {
                lyric_width: current_width,
            };
            if let Some(layout) = s.update_layout(params) {
                let js_layout: JsTaskbarLayout = layout.into();
                tsfn.call(js_layout, ThreadsafeFunctionCallMode::NonBlocking);
                return true;
            }
        }
    }

    true
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
    /// 监听 HKCU 下指定子键变化；`sub_key` 用反斜杠分隔，如
    /// `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced`
    #[napi(constructor, ts_args_type = "subKey: string, callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        sub_key: String,
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
            registry_watch_loop(&thread_event, &tsfn, &sub_key);
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
    sub_key: &str,
) {
    let stop_event = stop_event_wrapper.0;

    let mut h_key = HKEY::default();
    let sub_key_wide = HSTRING::from(sub_key);

    unsafe {
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &sub_key_wide,
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

// --- NapiTaskbarCreatedWatcher ---

#[napi(js_name = "TaskbarCreatedWatcher")]
pub struct NapiTaskbarCreatedWatcher {
    inner: taskbar_created_watcher::TaskbarCreatedWatcher,
}

#[napi]
impl NapiTaskbarCreatedWatcher {
    #[napi(constructor, ts_args_type = "callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        callback: Function<(), UnknownReturnValue>,
    ) -> napi::Result<Self> {
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
