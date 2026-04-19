use std::{
    sync::{Arc, LazyLock, Mutex},
    thread,
};

use anyhow::Result;
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

use crate::utils::find_taskbar_hwnd;

pub type TrayChangedCallback = Box<dyn Fn() + Send + Sync + 'static>;

static GLOBAL_CALLBACK: LazyLock<Mutex<Option<Arc<TrayChangedCallback>>>> =
    LazyLock::new(|| Mutex::new(None));

unsafe extern "system" fn win_event_proc(
    _h_win_event_hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _dw_ms_event_time: u32,
) {
    if event == EVENT_OBJECT_LOCATIONCHANGE && id_object == 0 {
        let mut buffer = [0u16; 64];
        let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
        if len > 0 {
            let name = String::from_utf16_lossy(&buffer[..len as usize]);
            if name == "TrayNotifyWnd" {
                // 先 clone Arc 再释放锁，避免回调执行期间阻塞其它 GLOBAL_CALLBACK 访问
                let callback = GLOBAL_CALLBACK
                    .lock()
                    .ok()
                    .and_then(|guard| guard.as_ref().cloned());
                if let Some(cb) = callback {
                    cb();
                }
            }
        }
    }
}

pub struct TrayWatcher {
    thread_id: Option<u32>,
}

impl TrayWatcher {
    pub fn new(callback: TrayChangedCallback) -> Result<Self> {
        let callback_arc = Arc::new(callback);

        if let Ok(mut guard) = GLOBAL_CALLBACK.lock() {
            *guard = Some(callback_arc);
        }

        let (tx, rx) = std::sync::mpsc::channel();

        thread::spawn(move || unsafe {
            let current_tid = GetCurrentThreadId();
            let _ = tx.send(current_tid);

            let mut pid = 0;
            let explorer_tid = find_taskbar_hwnd()
                .map_or(0, |hwnd| GetWindowThreadProcessId(hwnd, Some(&raw mut pid)));

            let mut hook_handle = HWINEVENTHOOK(std::ptr::null_mut());

            if explorer_tid != 0 {
                hook_handle = SetWinEventHook(
                    EVENT_OBJECT_LOCATIONCHANGE,
                    EVENT_OBJECT_LOCATIONCHANGE,
                    None,
                    Some(win_event_proc),
                    pid,
                    explorer_tid,
                    WINEVENT_OUTOFCONTEXT,
                );
            }

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {}

            if !hook_handle.0.is_null() {
                let _ = UnhookWinEvent(hook_handle);
            }
        });

        let thread_id = rx.recv()?;

        Ok(Self {
            thread_id: Some(thread_id),
        })
    }

    pub fn stop(&mut self) {
        if let Some(tid) = self.thread_id {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            self.thread_id = None;
            if let Ok(mut guard) = GLOBAL_CALLBACK.lock() {
                *guard = None;
            }
        }
    }
}

impl Drop for TrayWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
