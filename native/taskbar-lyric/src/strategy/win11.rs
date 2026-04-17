use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            FindWindowExW, GWL_EXSTYLE, GWL_STYLE, GetWindowRect, SetParent,
            WINDOW_EX_STYLE, WINDOW_STYLE, WS_CAPTION, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
            WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
        },
    },
    core::w,
};

use crate::{
    strategy::{
        AvailableSpace, ExtraLayoutInfo, LayoutParams, Rect, SystemType, TaskbarLayout,
        TaskbarStrategy,
    },
    uia::TaskbarScanner,
    utils::{BRIDGE_CLASS, check_registry_value, find_taskbar_hwnd, modify_window_long},
};

pub struct Win11Strategy {
    h_taskbar: HWND,
    scanner: Option<TaskbarScanner>,
}

impl Win11Strategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            scanner: None,
        }
    }

    fn is_taskbar_center_align() -> bool {
        check_registry_value("TaskbarAl", |val| val == 1, true)
    }
}

impl TaskbarStrategy for Win11Strategy {
    fn init(&mut self) -> bool {
        let Some(hwnd) = find_taskbar_hwnd() else {
            error!("Win11 初始化失败，找不到 Shell_TrayWnd");
            return false;
        };

        let h_bridge =
            unsafe { FindWindowExW(Some(hwnd), None, BRIDGE_CLASS, None) }.unwrap_or_default();

        if h_bridge.0.is_null() {
            error!("Win11 初始化失败，找不到 XAML 桥");
            return false;
        }

        self.h_taskbar = hwnd;
        debug!("Win11 策略初始化成功");
        true
    }

    fn embed_window(&self, child_wnd: HWND) -> bool {
        if self.h_taskbar.0.is_null() {
            return false;
        }

        unsafe {
            let _ = SetParent(child_wnd, Some(self.h_taskbar));

            modify_window_long(child_wnd, GWL_STYLE, |raw_style| {
                let style = WINDOW_STYLE(raw_style);
                let mask =
                    WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;
                (style & !mask).0
            });

            modify_window_long(child_wnd, GWL_EXSTYLE, |raw_style| {
                let ex_style = WINDOW_EX_STYLE(raw_style);
                (ex_style | WS_EX_LAYERED | WS_EX_TOOLWINDOW).0
            });
        }
        true
    }

    fn update_layout(&mut self, _params: LayoutParams) -> Option<TaskbarLayout> {
        if self.h_taskbar.0.is_null() {
            return None;
        }

        let mut tb_rect = RECT::default();
        unsafe {
            let _ = GetWindowRect(self.h_taskbar, &raw mut tb_rect);
        }

        let tray_rect = unsafe {
            let h_notify = FindWindowExW(Some(self.h_taskbar), None, w!("TrayNotifyWnd"), None)
                .unwrap_or_default();

            let mut rc = RECT::default();
            if !h_notify.0.is_null() {
                let _ = GetWindowRect(h_notify, &raw mut rc);
            }

            Rect {
                x: rc.left,
                y: rc.top,
                width: rc.right - rc.left,
                height: rc.bottom - rc.top,
            }
        };

        if self.scanner.is_none() {
            match TaskbarScanner::new() {
                Ok(s) => self.scanner = Some(s),
                Err(_) => {
                    error!("Scanner 初始化失败");
                    return None;
                }
            }
        }

        let uia_bounds = if let Some(scanner) = self.scanner.as_ref() {
            match scanner.scan_taskbar(self.h_taskbar) {
                Ok(b) => b,
                Err(_) => {
                    error!("scan_taskbar 失败");
                    self.scanner = None;
                    return None;
                }
            }
        } else {
            return None;
        };

        let is_centered = Self::is_taskbar_center_align();
        let tb_height = tb_rect.bottom - tb_rect.top;

        let content_left = uia_bounds.content.x;
        let content_right = uia_bounds.content.x + uia_bounds.content.width;

        let left_x = if uia_bounds.widgets.width > 0 && uia_bounds.widgets.x < content_left {
            uia_bounds.widgets.x + uia_bounds.widgets.width
        } else {
            tb_rect.left
        };

        let left_width = (content_left - left_x).max(0);

        let left_space = Rect {
            x: left_x - tb_rect.left,
            y: 0,
            width: left_width,
            height: tb_height,
        };

        let right_x = content_right;

        let right_right_edge =
            if uia_bounds.widgets.width > 0 && uia_bounds.widgets.x > content_right {
                uia_bounds.widgets.x
            } else if tray_rect.width > 0 {
                tray_rect.x
            } else {
                tb_rect.right
            };

        let right_width = (right_right_edge - right_x).max(0);

        let right_space = Rect {
            x: right_x - tb_rect.left,
            y: 0,
            width: right_width,
            height: tb_height,
        };

        Some(TaskbarLayout {
            space: AvailableSpace {
                left: left_space,
                right: right_space,
            },
            extra: ExtraLayoutInfo {
                system_type: SystemType::Win11,
                is_centered,
            },
        })
    }

    fn restore(&self) {}
}

impl Drop for Win11Strategy {
    fn drop(&mut self) {
        self.restore();
    }
}
