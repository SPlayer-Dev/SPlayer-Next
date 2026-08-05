#![allow(clippy::ptr_as_ptr)]
#![allow(clippy::borrow_as_ptr)]
#![allow(clippy::ref_as_ptr)]
#![allow(clippy::inline_always)]

use std::{
    sync::{Mutex, mpsc},
    thread::{self, JoinHandle},
    time::Duration,
};

use anyhow::{Result, anyhow};
use windows::{
    Win32::{
        Foundation::{LPARAM, WPARAM},
        System::{
            Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, SAFEARRAY},
            Threading::GetCurrentThreadId,
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationElement,
                IUIAutomationStructureChangedEventHandler,
                IUIAutomationStructureChangedEventHandler_Impl, StructureChangeType,
                TreeScope_Descendants,
            },
            WindowsAndMessaging::{
                DispatchMessageW, GetMessageW, MSG, PostThreadMessageW, TranslateMessage, WM_QUIT,
            },
        },
    },
    core::{Ref, Result as WinResult, implement},
};

use crate::utils::{ComApartmentGuard, ensure_thread_message_queue, find_taskbar_hwnd};

pub type LayoutChangedCallback = Box<dyn Fn() + Send + Sync + 'static>;

/// UIA 事件去抖窗口。任务栏重排/启动时事件瞬间触发几十次，必须聚合避免反复重扫整棵 XAML 树
const DEBOUNCE_MS: u64 = 150;

// 注意：不要注册 PropertyChangedEventHandler（BoundingRectangle 等）。
// windows-rs 0.62 的 #[implement] 为该接口生成的 shim 把按值传入的 VARIANT 当作
// owned 值在返回时 drop（VariantClear），而按 COM 约定调用方 UIA 也会释放同一份；
// BoundingRectangle 的值是含 SAFEARRAY 的 VARIANT，每个事件都双重释放，
// 数个事件内必现堆损坏崩溃（0xC0000374）。纯位置变化由 TrayWatcher 的
// WinEventHook（EVENT_OBJECT_LOCATIONCHANGE）兜底，这里只依赖结构变化事件
//（其 runtime_id 参数是指针传递，不经历 shim 的 owned drop，安全）。
#[implement(IUIAutomationStructureChangedEventHandler)]
pub struct TaskbarEventHandler {
    pulse: Mutex<mpsc::Sender<()>>,
}

impl TaskbarEventHandler {
    pub fn new(pulse: mpsc::Sender<()>) -> Self {
        Self {
            pulse: Mutex::new(pulse),
        }
    }

    fn notify(&self) {
        if let Ok(tx) = self.pulse.lock() {
            let _ = tx.send(());
        }
    }
}

impl IUIAutomationStructureChangedEventHandler_Impl for TaskbarEventHandler_Impl {
    fn HandleStructureChangedEvent(
        &self,
        _sender: Ref<'_, IUIAutomationElement>,
        _change_type: StructureChangeType,
        _runtime_id: *const SAFEARRAY,
    ) -> WinResult<()> {
        self.notify();
        Ok(())
    }
}

pub struct UiaWatcher {
    thread_id: Option<u32>,
    message_thread: Option<JoinHandle<()>>,
    debounce_thread: Option<JoinHandle<()>>,
}

impl UiaWatcher {
    pub fn new(callback: LayoutChangedCallback) -> Result<Self> {
        let (tid_tx, tid_rx) = mpsc::channel::<Result<u32>>();
        let (pulse_tx, pulse_rx) = mpsc::channel::<()>();

        // 去抖线程：DEBOUNCE_MS 窗口内的多次 pulse 聚合成一次 callback
        // 不能在 COM 事件 handler 里直接 sleep——会阻塞 UIA 事件循环
        let debounce_thread = thread::spawn(move || {
            while pulse_rx.recv().is_ok() {
                loop {
                    match pulse_rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                        Ok(()) => continue,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                callback();
            }
        });

        // SAFETY: COM apartment、UIA handler 和消息循环都在同一线程建立并配对清理。
        let message_thread = thread::spawn(move || unsafe {
            // 进入 MTA apartment，作用域结束自动配对 CoUninitialize
            let Some(_com_guard) = ComApartmentGuard::try_init() else {
                let _ = tid_tx.send(Err(anyhow!("初始化 UIA COM apartment 失败")));
                return;
            };

            let thread_id = GetCurrentThreadId();
            ensure_thread_message_queue();

            let automation: IUIAutomation =
                match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                    Ok(automation) => automation,
                    Err(_) => {
                        let _ = tid_tx.send(Err(anyhow!("创建 UIA automation 失败")));
                        return;
                    }
                };
            let Some(hwnd) = find_taskbar_hwnd() else {
                let _ = tid_tx.send(Err(anyhow!("找不到任务栏窗口")));
                return;
            };
            let root_element = match automation.ElementFromHandle(hwnd) {
                Ok(element) => element,
                Err(_) => {
                    let _ = tid_tx.send(Err(anyhow!("获取任务栏 UIA 根元素失败")));
                    return;
                }
            };
            let struct_handler: IUIAutomationStructureChangedEventHandler =
                TaskbarEventHandler::new(pulse_tx).into();
            if automation
                .AddStructureChangedEventHandler(
                    &root_element,
                    TreeScope_Descendants,
                    None,
                    &struct_handler,
                )
                .is_err()
            {
                let _ = tid_tx.send(Err(anyhow!("注册 UIA 结构变化事件失败")));
                return;
            }
            let _handlers_guard = struct_handler;
            let _ = tid_tx.send(Ok(thread_id));

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&raw const msg);
                let _ = DispatchMessageW(&raw const msg);
            }

            let _ = automation.RemoveAllEventHandlers();
            drop(_handlers_guard);
            // _com_guard 在 closure 结束时 drop 配对 CoUninitialize
        });

        let thread_id = tid_rx
            .recv()
            .map_err(|error| anyhow!("获取线程 ID 失败: {error}"))??;

        Ok(Self {
            thread_id: Some(thread_id),
            message_thread: Some(message_thread),
            debounce_thread: Some(debounce_thread),
        })
    }

    pub fn stop(&mut self) {
        if let Some(tid) = self.thread_id {
            // SAFETY: tid 来自已经建立消息队列的 UIA watcher 线程。
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            self.thread_id = None;
            if let Some(thread) = self.message_thread.take() {
                let _ = thread.join();
            }
            if let Some(thread) = self.debounce_thread.take() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for UiaWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
