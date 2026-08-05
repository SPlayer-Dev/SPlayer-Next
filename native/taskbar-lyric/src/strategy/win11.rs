use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{FindWindowExW, GetWindowRect},
    },
    core::w,
};

use crate::{
    strategy::{
        AvailableSpace, EmbeddedWindow, ExtraLayoutInfo, LayoutParams, Rect, SystemType,
        TaskbarLayout, TaskbarStrategy,
    },
    uia::TaskbarScanner,
    utils::{BRIDGE_CLASS, check_registry_value, find_taskbar_hwnd, read_system_uses_light_theme},
};

pub struct Win11Strategy {
    h_taskbar: HWND,
    scanner: Option<TaskbarScanner>,
    embedded: Option<EmbeddedWindow>,
}

impl Win11Strategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            scanner: None,
            embedded: None,
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

        // SAFETY: hwnd 是已验证的任务栏窗口，BRIDGE_CLASS 是静态类名。
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

    fn embed_window(&mut self, child_wnd: HWND) -> bool {
        self.embedded = None;
        match EmbeddedWindow::attach(child_wnd, self.h_taskbar) {
            Ok(embedded) => {
                self.embedded = Some(embedded);
                true
            }
            Err(_error) => {
                error!("任务栏歌词窗口嵌入失败: {_error}");
                false
            }
        }
    }

    fn update_layout(&mut self, _params: LayoutParams) -> Option<TaskbarLayout> {
        if self.h_taskbar.0.is_null() {
            return None;
        }

        let mut tb_rect = RECT::default();
        // SAFETY: h_taskbar 在 init 中通过 explorer 进程校验，RECT 是有效出参。
        unsafe {
            if GetWindowRect(self.h_taskbar, &raw mut tb_rect).is_err() {
                return None;
            }
        }

        // SAFETY: 只枚举 h_taskbar 的已知系统子窗口并读取其矩形。
        let tray_rect = unsafe {
            let h_notify = FindWindowExW(Some(self.h_taskbar), None, w!("TrayNotifyWnd"), None)
                .unwrap_or_default();

            let mut rc = RECT::default();
            if !h_notify.0.is_null() && GetWindowRect(h_notify, &raw mut rc).is_err() {
                return None;
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
                is_light: read_system_uses_light_theme(),
            },
        })
    }

    fn restore(&mut self) {
        self.embedded = None;
    }
}

impl Drop for Win11Strategy {
    fn drop(&mut self) {
        self.restore();
    }
}
