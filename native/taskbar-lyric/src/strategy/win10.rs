use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            FindWindowExW, GWL_EXSTYLE, GWL_STYLE, GetWindowRect, MoveWindow, SetParent,
            WINDOW_EX_STYLE, WINDOW_STYLE, WS_CAPTION, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
            WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
        },
    },
    core::{PCWSTR, w},
};

use crate::{
    GAP,
    strategy::{
        AvailableSpace, ExtraLayoutInfo, LayoutParams, Rect, SystemType, TaskbarLayout,
        TaskbarStrategy,
    },
    utils::{find_taskbar_hwnd, modify_window_long},
};

#[allow(clippy::struct_field_names)]
pub struct LegacyStrategy {
    h_taskbar: HWND,
    h_rebar: HWND,
    h_tasklist: HWND,
}

impl LegacyStrategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            h_rebar: HWND::default(),
            h_tasklist: HWND::default(),
        }
    }

    unsafe fn find_child_window(
        parent: HWND,
        class_name: PCWSTR,
        fallback: Option<PCWSTR>,
    ) -> HWND {
        let hwnd =
            unsafe { FindWindowExW(Some(parent), None, class_name, None).unwrap_or_default() };
        if hwnd.0.is_null()
            && let Some(fb) = fallback
        {
            return unsafe { FindWindowExW(Some(parent), None, fb, None).unwrap_or_default() };
        }
        hwnd
    }
}

impl TaskbarStrategy for LegacyStrategy {
    fn init(&mut self) -> bool {
        if let Some(hwnd) = find_taskbar_hwnd() {
            self.h_taskbar = hwnd;
            debug!("找到 Shell_TrayWnd");
        } else {
            return false;
        }

        unsafe {
            self.h_rebar =
                Self::find_child_window(self.h_taskbar, w!("ReBarWindow32"), Some(w!("WorkerW")));

            if self.h_rebar.0.is_null() {
                error!("未能找到 ReBarWindow32");
                return false;
            }

            self.h_tasklist = Self::find_child_window(
                self.h_rebar,
                w!("MSTaskSwWClass"),
                Some(w!("MSTaskListWClass")),
            );

            if self.h_tasklist.0.is_null() {
                error!("未能找到 MSTaskSwWClass/MSTaskListWClass");
                return false;
            }
        }

        debug!("Win10 策略初始化成功");
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

    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout> {
        if self.h_rebar.0.is_null() || self.h_tasklist.0.is_null() {
            return None;
        }

        unsafe {
            let mut rc_rebar = RECT::default();
            let _ = GetWindowRect(self.h_rebar, &raw mut rc_rebar);

            let mut rc_taskbar = RECT::default();
            let _ = GetWindowRect(self.h_taskbar, &raw mut rc_taskbar);

            let mut rc_tasklist = RECT::default();
            let _ = GetWindowRect(self.h_tasklist, &raw mut rc_tasklist);

            let rebar_w = rc_rebar.right - rc_rebar.left;
            let rebar_h = rc_rebar.bottom - rc_rebar.top;
            let is_vertical = rebar_h > rebar_w;

            let (bx, by, bw, bh) = if is_vertical {
                let offset_y = rc_tasklist.top - rc_rebar.top;
                let mut new_tasklist_h = rebar_h - offset_y - params.lyric_width - GAP;
                if new_tasklist_h < 0 {
                    new_tasklist_h = 0;
                }
                let _ = MoveWindow(self.h_tasklist, 0, offset_y, rebar_w, new_tasklist_h, true);
                (
                    rc_rebar.left - rc_taskbar.left,
                    (rc_rebar.top - rc_taskbar.top) + offset_y + new_tasklist_h + GAP,
                    rebar_w,
                    params.lyric_width,
                )
            } else {
                let offset_x = rc_tasklist.left - rc_rebar.left;
                let mut new_tasklist_w = rebar_w - offset_x - params.lyric_width - GAP;
                if new_tasklist_w < 0 {
                    new_tasklist_w = 0;
                }
                let _ = MoveWindow(self.h_tasklist, offset_x, 0, new_tasklist_w, rebar_h, true);
                (
                    (rc_rebar.left - rc_taskbar.left) + offset_x + new_tasklist_w + GAP,
                    rc_rebar.top - rc_taskbar.top,
                    params.lyric_width,
                    rebar_h,
                )
            };

            trace!("Win10 布局计算完成");

            let lyric_space = Rect {
                x: bx,
                y: by,
                width: bw,
                height: bh,
            };

            Some(TaskbarLayout {
                space: AvailableSpace {
                    left: Rect::default(),
                    right: lyric_space,
                },
                extra: ExtraLayoutInfo {
                    system_type: SystemType::Win10,
                    is_centered: false,
                },
            })
        }
    }

    fn restore(&self) {
        if self.h_rebar.0.is_null() || self.h_tasklist.0.is_null() {
            return;
        }

        unsafe {
            let mut rc_rebar = RECT::default();
            let _ = GetWindowRect(self.h_rebar, &raw mut rc_rebar);

            let mut rc_tasklist = RECT::default();
            let _ = GetWindowRect(self.h_tasklist, &raw mut rc_tasklist);

            let rebar_w = rc_rebar.right - rc_rebar.left;
            let rebar_h = rc_rebar.bottom - rc_rebar.top;
            let is_vertical = rebar_h > rebar_w;

            if is_vertical {
                let offset_y = rc_tasklist.top - rc_rebar.top;
                let original_height = rebar_h - offset_y;
                let _ = MoveWindow(self.h_tasklist, 0, offset_y, rebar_w, original_height, true);
            } else {
                let offset_x = rc_tasklist.left - rc_rebar.left;
                let original_width = rebar_w - offset_x;
                let _ = MoveWindow(self.h_tasklist, offset_x, 0, original_width, rebar_h, true);
            }
        }
    }
}

impl Drop for LegacyStrategy {
    fn drop(&mut self) {
        self.restore();
    }
}
