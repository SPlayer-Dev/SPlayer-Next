use anyhow::{Context, Result, bail};
use windows::Win32::{
    Foundation::HWND,
    System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
    UI::{
        Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants,
        },
        WindowsAndMessaging::FindWindowExW,
    },
};

use crate::{
    strategy::Rect,
    utils::{BRIDGE_CLASS, ComApartmentGuard},
};

const CLASS_TASKLIST_BUTTON: &str = "Taskbar.TaskListButtonAutomationPeer";
const ID_START_BUTTON: &str = "StartButton";
const ID_SEARCH_BUTTON: &str = "SearchButton";
const ID_SEARCH_TEXT: &str = "SearchBoxTextBlock";
const ID_WIDGETS_BUTTON: &str = "WidgetsButton";

pub struct TaskbarScanner {
    /// 顺序很关键：automation 必须在 _com_guard 之前 drop，否则 COM 对象释放时 apartment 已退出
    automation: IUIAutomation,
    _com_guard: ComApartmentGuard,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct TaskbarContentBounds {
    pub start_btn: Rect,
    pub widgets: Rect,
    pub content: Rect,
}

impl TaskbarScanner {
    pub fn new() -> Result<Self> {
        let com_guard = ComApartmentGuard::try_init().context("COM 初始化失败")?;
        // SAFETY: CoCreateInstance 在 apartment 内调用，自动化对象由 guard 生命周期覆盖
        let automation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .context("无法创建 UIAutomation 实例")?
        };
        Ok(Self {
            automation,
            _com_guard: com_guard,
        })
    }

    pub fn get_element_from_handle(&self, hwnd: HWND) -> Result<IUIAutomationElement> {
        // SAFETY: automation 的 COM apartment guard 由 self 持有，hwnd 由调用方先验证。
        unsafe { Ok(self.automation.ElementFromHandle(hwnd)?) }
    }

    pub fn scan_taskbar(&self, taskbar_hwnd: HWND) -> Result<TaskbarContentBounds> {
        // SAFETY: 整个 UIA 查询在构造时建立的 COM apartment 内执行，所有 COM 对象由 Retained 接管。
        unsafe {
            let mut child_hwnd = HWND::default();
            let true_condition = self.automation.CreateTrueCondition()?;

            loop {
                child_hwnd =
                    FindWindowExW(Some(taskbar_hwnd), Some(child_hwnd), BRIDGE_CLASS, None)?;

                if child_hwnd.0.is_null() {
                    break;
                }

                if let Ok(bridge_element) = self.get_element_from_handle(child_hwnd)
                    && let Ok(items) =
                        bridge_element.FindAll(TreeScope_Descendants, &true_condition)
                {
                    let count = items.Length().unwrap_or(0);
                    let mut bounds = TaskbarContentBounds::default();
                    let mut found_any = false;

                    for i in 0..count {
                        let Ok(item) = items.GetElement(i) else {
                            continue;
                        };
                        let Ok(id_bstr) = item.CurrentAutomationId() else {
                            continue;
                        };
                        let Ok(rect_raw) = item.CurrentBoundingRectangle() else {
                            continue;
                        };
                        let id = id_bstr.to_string();

                        let rect = Rect {
                            x: rect_raw.left,
                            y: rect_raw.top,
                            width: rect_raw.right - rect_raw.left,
                            height: rect_raw.bottom - rect_raw.top,
                        };

                        if id == ID_WIDGETS_BUTTON {
                            bounds.widgets = rect;
                        } else if id == ID_START_BUTTON {
                            bounds.start_btn = rect;
                        }

                        let Ok(class_name_bstr) = item.CurrentClassName() else {
                            continue;
                        };
                        let class_name = class_name_bstr.to_string();

                        let is_app_icon = class_name == CLASS_TASKLIST_BUTTON;
                        let is_content_element = is_app_icon
                            || id == ID_START_BUTTON
                            || id == ID_SEARCH_BUTTON
                            || id == ID_SEARCH_TEXT;

                        if is_content_element && rect.width > 0 {
                            bounds.content.union(&rect);
                            found_any = true;
                        }
                    }

                    if found_any {
                        return Ok(bounds);
                    }
                }
            }
        }

        bail!("未找到有效的任务栏图标区域")
    }
}
