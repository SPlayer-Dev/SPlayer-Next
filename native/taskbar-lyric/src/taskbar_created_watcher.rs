//! 监听 `TaskbarCreated` 广播（explorer.exe 重建任务栏时发出）。
//! 只有顶层无父窗口能收到，所以这里建一个隐藏的顶层窗口。

use std::{
    ffi::c_void,
    mem,
    sync::{Arc, LazyLock},
    thread::{self, JoinHandle},
};

use anyhow::{Result, anyhow};
use windows::{
    Win32::{
        Foundation::{ERROR_CLASS_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, WPARAM},
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
        UI::WindowsAndMessaging::{
            CREATESTRUCTW, CW_USEDEFAULT, CreateWindowExW, DefWindowProcW, DestroyWindow,
            DispatchMessageW, GWLP_USERDATA, GetMessageW, GetWindowLongPtrW, MSG,
            PostThreadMessageW, RegisterClassExW, RegisterWindowMessageW, SetWindowLongPtrW,
            TranslateMessage, UnregisterClassW, WINDOW_EX_STYLE, WM_NCCREATE, WM_NCDESTROY,
            WM_QUIT, WNDCLASSEXW, WS_OVERLAPPED,
        },
    },
    core::{PCWSTR, w},
};

use crate::utils::ensure_thread_message_queue;

pub type TaskbarCreatedCallback = Box<dyn Fn() + Send + Sync + 'static>;

// SAFETY: 注册只读取进程内静态消息名，LazyLock 保证仅执行一次。
static TASKBAR_CREATED_MSG: LazyLock<u32> =
    LazyLock::new(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) });

const WINDOW_CLASS: PCWSTR = w!("SPlayerTaskbarCreatedWatcher");

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_NCCREATE {
        // SAFETY: lparam 是 CreateWindowExW 在 WM_NCCREATE 传入的 CREATESTRUCTW。
        let create = unsafe { &*(lparam.0 as *const CREATESTRUCTW) };
        // SAFETY: lpCreateParams 指向 watcher 线程闭包持有的 Arc 内容，写入当前窗口私有槽。
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize) };
    }
    // SAFETY: 仅读取当前窗口的实例私有槽。
    let callback_ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) };
    if msg == *TASKBAR_CREATED_MSG {
        debug!("收到 TaskbarCreated 广播");
        if callback_ptr != 0 {
            // SAFETY: 指针由线程闭包持有的 Arc 保证到 DestroyWindow 返回前有效。
            let callback = unsafe { &*(callback_ptr as *const TaskbarCreatedCallback) };
            callback();
        }
        return LRESULT(0);
    }
    if msg == WM_NCDESTROY && callback_ptr != 0 {
        // SAFETY: 先清空窗口槽；Arc 由 watcher 线程闭包持有到 DestroyWindow 返回之后。
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
    }
    // SAFETY: 未处理的窗口消息按 Win32 约定转交默认过程。
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

pub struct TaskbarCreatedWatcher {
    thread_id: Option<u32>,
    thread: Option<JoinHandle<()>>,
}

impl TaskbarCreatedWatcher {
    pub fn new(callback: TaskbarCreatedCallback) -> Result<Self> {
        let callback_arc = Arc::new(callback);

        let (tx, rx) = std::sync::mpsc::channel::<Result<u32>>();

        // SAFETY: 所有窗口类、隐藏窗口和消息循环资源都限制在该线程创建和释放。
        let thread = thread::spawn(move || unsafe {
            let tid = GetCurrentThreadId();
            ensure_thread_message_queue();

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
                    let _ = tx.send(Err(anyhow!("注册 TaskbarCreated watcher 窗口类失败")));
                    return;
                }
            }

            let callback_ptr = Arc::as_ptr(&callback_arc);
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
                Some(callback_ptr.cast::<c_void>()),
            )
            .unwrap_or_default();

            if hwnd.0.is_null() {
                error!("CreateWindowExW 失败");
                let _ = UnregisterClassW(WINDOW_CLASS, Some(hinstance.into()));
                let _ = tx.send(Err(anyhow!("创建 TaskbarCreated watcher 窗口失败")));
                return;
            }

            debug!("TaskbarCreated 监听窗口已创建");
            let _ = tx.send(Ok(tid));

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&raw const msg);
                let _ = DispatchMessageW(&raw const msg);
            }

            let _ = DestroyWindow(hwnd);
            let _ = UnregisterClassW(WINDOW_CLASS, Some(hinstance.into()));
        });

        let thread_id = rx.recv().map_err(|e| anyhow!("获取线程 ID 失败: {e}"))??;

        Ok(Self {
            thread_id: Some(thread_id),
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        if let Some(tid) = self.thread_id {
            // SAFETY: tid 来自成功启动并创建消息队列的 watcher 线程。
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

impl Drop for TaskbarCreatedWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
