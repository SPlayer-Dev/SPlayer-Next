use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
    thread::{self, JoinHandle},
};

use anyhow::{Result, anyhow};
use windows::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent},
        WindowsAndMessaging::{
            EVENT_OBJECT_LOCATIONCHANGE, GetClassNameW, GetMessageW, GetWindowThreadProcessId, MSG,
            PostThreadMessageW, WINEVENT_OUTOFCONTEXT, WM_QUIT,
        },
    },
};

use crate::utils::{ensure_thread_message_queue, find_taskbar_hwnd};

pub type TrayChangedCallback = Box<dyn Fn() + Send + Sync + 'static>;

/// WinEvent callback 没有 user-data 参数，只能通过回传的 hook handle 查找实例上下文。
/// 每个 hook 独立注册/注销，避免旧实例调用新实例的单一全局 callback slot。
static CALLBACKS: LazyLock<Mutex<HashMap<isize, Arc<TrayChangedCallback>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

unsafe extern "system" fn win_event_proc(
    h_win_event_hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _dw_ms_event_time: u32,
) {
    if event == EVENT_OBJECT_LOCATIONCHANGE && id_object == 0 {
        let mut buffer = [0u16; 64];
        // SAFETY: hwnd 来自系统 WinEvent 回调，buffer 是有效可写切片。
        let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
        if len > 0 {
            let name = String::from_utf16_lossy(&buffer[..len as usize]);
            if name == "TrayNotifyWnd" {
                // 先 clone Arc 再释放锁，避免回调执行期间阻塞 hook 注册与注销。
                let callback = CALLBACKS
                    .lock()
                    .ok()
                    .and_then(|guard| guard.get(&(h_win_event_hook.0 as isize)).cloned());
                if let Some(cb) = callback {
                    cb();
                }
            }
        }
    }
}

pub struct TrayWatcher {
    thread_id: Option<u32>,
    thread: Option<JoinHandle<()>>,
}

impl TrayWatcher {
    pub fn new(callback: TrayChangedCallback) -> Result<Self> {
        let callback_arc = Arc::new(callback);

        let (tx, rx) = std::sync::mpsc::channel::<Result<u32>>();

        // SAFETY: hook 和消息队列均在该线程创建、使用并在退出前释放。
        let thread = thread::spawn(move || unsafe {
            let current_tid = GetCurrentThreadId();
            ensure_thread_message_queue();

            let mut pid = 0;
            let Some(taskbar_hwnd) = find_taskbar_hwnd() else {
                let _ = tx.send(Err(anyhow!("找不到任务栏窗口")));
                return;
            };
            let explorer_tid = GetWindowThreadProcessId(taskbar_hwnd, Some(&raw mut pid));
            if explorer_tid == 0 {
                let _ = tx.send(Err(anyhow!("获取任务栏线程失败")));
                return;
            }

            let hook_handle = SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(win_event_proc),
                pid,
                explorer_tid,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook_handle.0.is_null() {
                let _ = tx.send(Err(anyhow!("注册任务栏 WinEventHook 失败")));
                return;
            }
            if let Ok(mut callbacks) = CALLBACKS.lock() {
                callbacks.insert(hook_handle.0 as isize, Arc::clone(&callback_arc));
            } else {
                let _ = UnhookWinEvent(hook_handle);
                let _ = tx.send(Err(anyhow!("注册任务栏 callback 上下文失败")));
                return;
            }
            let _ = tx.send(Ok(current_tid));

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {}

            if !hook_handle.0.is_null() {
                let _ = UnhookWinEvent(hook_handle);
                if let Ok(mut callbacks) = CALLBACKS.lock() {
                    callbacks.remove(&(hook_handle.0 as isize));
                }
            }
        });

        let thread_id = rx.recv()??;

        Ok(Self {
            thread_id: Some(thread_id),
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        if let Some(tid) = self.thread_id {
            // SAFETY: tid 来自成功建立消息队列并安装 hook 的 watcher 线程。
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            self.thread_id = None;
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for TrayWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
