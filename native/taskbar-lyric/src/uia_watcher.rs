#![allow(clippy::ptr_as_ptr)]
#![allow(clippy::borrow_as_ptr)]
#![allow(clippy::ref_as_ptr)]
#![allow(clippy::inline_always)]

use std::{
    ptr,
    sync::{Arc, mpsc},
    thread,
};

use anyhow::{Result, anyhow};
use windows::{
    Win32::{
        Foundation::{LPARAM, RPC_E_CHANGED_MODE, WPARAM},
        System::{
            Com::{
                CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
                CoUninitialize, SAFEARRAY,
            },
            Threading::GetCurrentThreadId,
            Variant::VARIANT,
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationElement,
                IUIAutomationPropertyChangedEventHandler,
                IUIAutomationPropertyChangedEventHandler_Impl,
                IUIAutomationStructureChangedEventHandler,
                IUIAutomationStructureChangedEventHandler_Impl, StructureChangeType,
                TreeScope_Descendants, UIA_BoundingRectanglePropertyId, UIA_PROPERTY_ID,
            },
            WindowsAndMessaging::{
                DispatchMessageW, GetMessageW, MSG, PostThreadMessageW, TranslateMessage, WM_QUIT,
            },
        },
    },
    core::{Ref, Result as WinResult, implement},
};

use crate::utils::find_taskbar_hwnd;

pub type LayoutChangedCallback = Box<dyn Fn() + Send + Sync + 'static>;

#[implement(
    IUIAutomationPropertyChangedEventHandler,
    IUIAutomationStructureChangedEventHandler
)]
pub struct TaskbarEventHandler {
    callback: Arc<LayoutChangedCallback>,
}

impl TaskbarEventHandler {
    pub fn new(callback: Arc<LayoutChangedCallback>) -> Self {
        Self { callback }
    }

    fn notify(&self) {
        (self.callback)();
    }
}

impl IUIAutomationPropertyChangedEventHandler_Impl for TaskbarEventHandler_Impl {
    fn HandlePropertyChangedEvent(
        &self,
        _sender: Ref<'_, IUIAutomationElement>,
        property_id: UIA_PROPERTY_ID,
        _new_value: &VARIANT,
    ) -> WinResult<()> {
        if property_id == UIA_BoundingRectanglePropertyId {
            self.notify();
        }
        Ok(())
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
}

impl UiaWatcher {
    pub fn new(callback: LayoutChangedCallback) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<u32>();
        let callback_arc = Arc::new(callback);

        thread::spawn(move || unsafe {
            // RPC_E_CHANGED_MODE：调用线程已被其它代码路径初始化为另一种 apartment 模式，
            // 允许继续但末尾不能 CoUninitialize（成对关系由最初的 init 持有）
            let should_uninitialize = {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                if hr.is_ok() {
                    true
                } else if hr == RPC_E_CHANGED_MODE {
                    false
                } else {
                    let _ = tx.send(GetCurrentThreadId());
                    return;
                }
            };

            let thread_id = GetCurrentThreadId();
            let _ = tx.send(thread_id);

            let automation_res: WinResult<IUIAutomation> =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);

            let _handlers_guard = if let Ok(ref automation) = automation_res
                && let Some(hwnd) = find_taskbar_hwnd()
                && let Ok(root_element) = automation.ElementFromHandle(hwnd)
            {
                let handler1 = TaskbarEventHandler::new(callback_arc.clone());
                let handler2 = TaskbarEventHandler::new(callback_arc.clone());

                let prop_handler: IUIAutomationPropertyChangedEventHandler = handler1.into();
                let struct_handler: IUIAutomationStructureChangedEventHandler = handler2.into();

                let _ = automation.AddPropertyChangedEventHandler(
                    &root_element,
                    TreeScope_Descendants,
                    None,
                    &prop_handler,
                    ptr::null(),
                );

                let _ = automation.AddStructureChangedEventHandler(
                    &root_element,
                    TreeScope_Descendants,
                    None,
                    &struct_handler,
                );

                Some((prop_handler, struct_handler))
            } else {
                None
            };

            let mut msg = MSG::default();
            while GetMessageW(&raw mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&raw const msg);
                let _ = DispatchMessageW(&raw const msg);
            }

            if let Ok(automation) = automation_res {
                let _ = automation.RemoveAllEventHandlers();
            }

            drop(_handlers_guard);
            if should_uninitialize {
                CoUninitialize();
            }
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
        }
    }
}

impl Drop for UiaWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
