use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        GW_HWNDPREV, GWL_EXSTYLE, GWL_STYLE, GWLP_HWNDPARENT, GetWindow, GetWindowLongPtrW,
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowLongPtrW, SetWindowPos,
        WINDOW_EX_STYLE, WINDOW_STYLE, WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    },
};

use crate::utils::modify_window_long;

mod win10;
mod win11;

/// win10/win11 共用的嵌入逻辑：把任务栏设为 child_wnd 的 owner，去掉标题栏 / 边框等装饰位，
/// 加上 TOOLWINDOW + NOACTIVATE。parent_wnd 为空时返回 false 不做任何修改
/// 不能加 LAYERED：顶层 Chromium 窗口走 DirectComposition，加了会整窗不可见
///
/// 不能用 SetParent：explorer 退出时跨线程子窗口只收到 WM_NCDESTROY（无 WM_DESTROY），
/// Chromium 在窗口过程里 CHECK 失败，整个主进程以 0xC000041D 退出，且进程内无从拦截；
/// 父子关系还会挂接两边输入队列，explorer 卡死会连带卡死主进程 UI 线程。
/// owner 关系下 explorer 退出时只是 owner 置空，z 序由 [`sync_z_order`] 跟随任务栏
pub(super) fn embed_child_window(child_wnd: HWND, parent_wnd: HWND) -> bool {
    if parent_wnd.0.is_null() {
        return false;
    }

    // SAFETY: child_wnd 由调用方校验过有效性（take_valid_hwnd），parent_wnd 是 init 时拿到的任务栏
    unsafe {
        let _ = SetWindowLongPtrW(child_wnd, GWLP_HWNDPARENT, parent_wnd.0 as isize);

        modify_window_long(child_wnd, GWL_STYLE, |raw_style| {
            let style = WINDOW_STYLE(raw_style);
            let mask = WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;
            (style & !mask).0
        });

        modify_window_long(child_wnd, GWL_EXSTYLE, |raw_style| {
            let ex_style = WINDOW_EX_STYLE(raw_style);
            (ex_style | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE).0
        });
    }
    sync_z_order(child_wnd, parent_wnd);
    true
}

/// 让歌词窗口跟随任务栏的置顶状态
///
/// explorer 在全屏应用前台时会撤掉任务栏的 TOPMOST 并压到底层，但不会连带降级 owned 窗口，
/// 且此过程不发任何可监听的 WinEvent，只能由调用方定时比对。
/// 任务栏置顶时歌词窗口须在其之上（explorer 重启后新任务栏会盖过已置顶的歌词窗口）；
/// 否则放到任务栏正下方，随任务栏一起被全屏应用盖住
pub fn sync_z_order(child_wnd: HWND, taskbar: HWND) {
    // SAFETY: 两个句柄失效时 GetWindowLongPtrW 返回 0、SetWindowPos 直接失败，均无副作用
    unsafe {
        let is_topmost =
            |hwnd: HWND| GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
        let taskbar_topmost = is_topmost(taskbar);
        let in_place = if taskbar_topmost {
            // 置顶层窗口很少，从任务栏往上找歌词窗口代价可忽略
            let mut above = GetWindow(taskbar, GW_HWNDPREV);
            loop {
                match above {
                    Ok(hwnd) if hwnd == child_wnd => break true,
                    Ok(hwnd) => above = GetWindow(hwnd, GW_HWNDPREV),
                    Err(_) => break false,
                }
            }
        } else {
            !is_topmost(child_wnd)
        };
        if in_place {
            return;
        }
        let insert_after = if taskbar_topmost {
            HWND_TOPMOST
        } else {
            taskbar
        };
        let _ = SetWindowPos(
            child_wnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

pub use win10::LegacyStrategy;
pub use win11::Win11Strategy;

#[derive(Debug, Clone, Copy)]
pub struct LayoutParams {
    pub lyric_width: i32,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn union(&mut self, other: &Self) {
        if self.width == 0 && self.height == 0 {
            *self = *other;
            return;
        }
        if other.width == 0 && other.height == 0 {
            return;
        }

        let my_right = self.x + self.width;
        let my_bottom = self.y + self.height;
        let other_right = other.x + other.width;
        let other_bottom = other.y + other.height;

        let new_left = self.x.min(other.x);
        let new_top = self.y.min(other.y);
        let new_right = my_right.max(other_right);
        let new_bottom = my_bottom.max(other_bottom);

        self.x = new_left;
        self.y = new_top;
        self.width = new_right - new_left;
        self.height = new_bottom - new_top;
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AvailableSpace {
    pub left: Rect,
    pub right: Rect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemType {
    Win10,
    Win11,
}

#[derive(Debug, Clone, Copy)]
pub struct ExtraLayoutInfo {
    pub system_type: SystemType,
    pub is_centered: bool,
    /// 任务栏是否为浅色主题（读自 `SystemUsesLightTheme`）
    pub is_light: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct TaskbarLayout {
    pub space: AvailableSpace,
    pub extra: ExtraLayoutInfo,
}

pub trait TaskbarStrategy {
    fn init(&mut self) -> bool;
    fn embed_window(&self, child_hwnd: HWND) -> bool;
    fn taskbar_hwnd(&self) -> HWND;
    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout>;
    fn restore(&self);
}
