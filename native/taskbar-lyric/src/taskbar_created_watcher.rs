//! 监听 `TaskbarCreated` 广播（explorer.exe 重建任务栏时发出）。
//! 只有顶层无父窗口能收到，所以这里建一个隐藏的顶层窗口。

use std::{
    mem,
    sync::{Arc, LazyLock, Mutex},
    thread,
};

use anyhow::{Result, anyhow};
use windows::{
    Win32::{
        Foundation::{ERROR_CLASS_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, WPARAM},
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
        UI::WindowsAndMessaging::{
            CW_USEDEFAULT, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
            GetMessageW, MSG, PostThreadMessageW, RegisterClassExW, RegisterWindowMessageW,
            TranslateMessage, UnregisterClassW, WINDOW_EX_STYLE, WM_QUIT, WNDCLASSEXW,
            WS_OVERLAPPED,
        },
    },
    core::{PCWSTR, w},
};

pub type TaskbarCreatedCallback = Box<dyn Fn() + Send + Sync + 'static>;

static GLOBAL_CALLBACK: LazyLock<Mutex<Option<Arc<TaskbarCreatedCallback>>>> =
    LazyLock::new(|| Mutex::new(None));

static TASKBAR_CREATED_MSG: LazyLock<u32> =
    LazyLock::new(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) });

const WINDOW_CLASS: PCWSTR = w!("SPlayerTaskbarCreatedWatcher");

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == *TASKBAR_CREATED_MSG {
        debug!("收到 TaskbarCreated 广播");
        let callback = GLOBAL_CALLBACK
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().cloned());
        if let Some(cb) = callback {
            cb();
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

pub struct TaskbarCreatedWatcher {
    thread_id: Option<u32>,
}

impl TaskbarCreatedWatcher {
    pub fn new(callback: TaskbarCreatedCallback) -> Result<Self> {
        let callback_arc = Arc::new(callback);
        if let Ok(mut guard) = GLOBAL_CALLBACK.lock() {
            *guard = Some(callback_arc);
        }

        let (tx, rx) = std::sync::mpsc::channel::<u32>();

        thread::spawn(move || unsafe {
            let tid = GetCurrentThreadId();
            let _ = tx.send(tid);

            let hinstance = GetModuleHandleW(None).unwrap_or_default();

            let wndclass = WNDCLASSEXW {
                cbSize: mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(window_proc),
                hInstance: hinstance.into(),
                lpszClassName: WINDOW_CLASS,
                ..Default::default()
            };
            // 类名全局唯一，同进程中若上一轮异常退出未及时清理会残留
            if RegisterClassExW(&raw const wndclass) == 0 {
                let err = GetLastError();
                if err != ERROR_CLASS_ALREADY_EXISTS {
                    error!("RegisterClassExW 失败: {:?}", err);
                    return;
                }
            }

            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                WINDOW_CLASS,
                w!("SPlayer Taskbar Watcher"),
                WS_OVERLAPPED,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                0,
                0,
                None,
                None,
                Some(hinstance.into()),
                None,
            )
            .unwrap_or_default();

            if hwnd.0.is_null() {
                error!("CreateWindowExW 失败");
                let _ = UnregisterClassW(WINDOW_CLASS, Some(hinstance.into()));
                return;
            }

            debug!("TaskbarCreated 监听窗口已创建");

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&raw const msg);
                let _ = DispatchMessageW(&raw const msg);
            }

            let _ = DestroyWindow(hwnd);
            let _ = UnregisterClassW(WINDOW_CLASS, Some(hinstance.into()));
        });

        let thread_id = rx.recv().map_err(|e| anyhow!("获取线程 ID 失败: {e}"))?;

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

impl Drop for TaskbarCreatedWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
