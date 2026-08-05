use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{FindWindowExW, GetWindowRect, MoveWindow},
    },
    core::{PCWSTR, w},
};

use crate::{
    GAP,
    strategy::{
        AvailableSpace, EmbeddedWindow, ExtraLayoutInfo, LayoutParams, Rect, SystemType,
        TaskbarLayout, TaskbarStrategy,
    },
    utils::{find_taskbar_hwnd, read_system_uses_light_theme},
};

#[allow(clippy::struct_field_names)]
pub struct LegacyStrategy {
    h_taskbar: HWND,
    h_rebar: HWND,
    h_tasklist: HWND,
    embedded: Option<EmbeddedWindow>,
}

impl LegacyStrategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            h_rebar: HWND::default(),
            h_tasklist: HWND::default(),
            embedded: None,
        }
    }

    unsafe fn find_child_window(
        parent: HWND,
        class_name: PCWSTR,
        fallback: Option<PCWSTR>,
    ) -> HWND {
        // SAFETY: parent 是已发现的任务栏窗口，类名是静态宽字符串。
        let hwnd =
            unsafe { FindWindowExW(Some(parent), None, class_name, None).unwrap_or_default() };
        if hwnd.0.is_null()
            && let Some(fb) = fallback
        {
            // SAFETY: 与主查询相同，仅使用备用的静态窗口类名。
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

        // SAFETY: 仅查询系统任务栏的子窗口句柄，不保留任何借用指针。
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

    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout> {
        if self.h_rebar.0.is_null() || self.h_tasklist.0.is_null() {
            return None;
        }

        // SAFETY: init 已验证并保存全部 HWND，RECT 出参在调用期间有效。
        unsafe {
            let mut rc_rebar = RECT::default();
            if GetWindowRect(self.h_rebar, &raw mut rc_rebar).is_err() {
                return None;
            }

            let mut rc_taskbar = RECT::default();
            if GetWindowRect(self.h_taskbar, &raw mut rc_taskbar).is_err() {
                return None;
            }

            let mut rc_tasklist = RECT::default();
            if GetWindowRect(self.h_tasklist, &raw mut rc_tasklist).is_err() {
                return None;
            }

            let rebar_w = rc_rebar.right - rc_rebar.left;
            let rebar_h = rc_rebar.bottom - rc_rebar.top;
            let is_vertical = rebar_h > rebar_w;

            let (bx, by, bw, bh) = if is_vertical {
                let offset_y = rc_tasklist.top - rc_rebar.top;
                let new_tasklist_h = rebar_h - offset_y - params.lyric_width - GAP;
                if new_tasklist_h < 0 {
                    // 空间不够时恢复 tasklist 原高度并返回 0 高——不能强压按钮区，会挤成一条线
                    if MoveWindow(
                        self.h_tasklist,
                        0,
                        offset_y,
                        rebar_w,
                        rebar_h - offset_y,
                        true,
                    )
                    .is_err()
                    {
                        return None;
                    }
                    (0, 0, 0, 0)
                } else {
                    if MoveWindow(self.h_tasklist, 0, offset_y, rebar_w, new_tasklist_h, true)
                        .is_err()
                    {
                        return None;
                    }
                    (
                        rc_rebar.left - rc_taskbar.left,
                        (rc_rebar.top - rc_taskbar.top) + offset_y + new_tasklist_h + GAP,
                        rebar_w,
                        params.lyric_width,
                    )
                }
            } else {
                let offset_x = rc_tasklist.left - rc_rebar.left;
                let new_tasklist_w = rebar_w - offset_x - params.lyric_width - GAP;
                if new_tasklist_w < 0 {
                    if MoveWindow(
                        self.h_tasklist,
                        offset_x,
                        0,
                        rebar_w - offset_x,
                        rebar_h,
                        true,
                    )
                    .is_err()
                    {
                        return None;
                    }
                    (0, 0, 0, 0)
                } else {
                    if MoveWindow(self.h_tasklist, offset_x, 0, new_tasklist_w, rebar_h, true)
                        .is_err()
                    {
                        return None;
                    }
                    (
                        (rc_rebar.left - rc_taskbar.left) + offset_x + new_tasklist_w + GAP,
                        rc_rebar.top - rc_taskbar.top,
                        params.lyric_width,
                        rebar_h,
                    )
                }
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
                    is_light: read_system_uses_light_theme(),
                },
            })
        }
    }

    fn restore(&mut self) {
        self.embedded = None;
        if self.h_rebar.0.is_null() || self.h_tasklist.0.is_null() {
            return;
        }

        // SAFETY: restore 只操作 init 阶段记录的任务栏窗口，并容忍窗口已经失效。
        unsafe {
            let mut rc_rebar = RECT::default();
            if GetWindowRect(self.h_rebar, &raw mut rc_rebar).is_err() {
                return;
            }

            let mut rc_tasklist = RECT::default();
            if GetWindowRect(self.h_tasklist, &raw mut rc_tasklist).is_err() {
                return;
            }

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
