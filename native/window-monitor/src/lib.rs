//! 前台窗口全屏探测原生模块
//!
//! 通过 Win32 读取前台窗口矩形，判断其是否完整覆盖所在显示器，
//! 用于"是否有其他应用正处于全屏"这一判断。
//!
//! 灵动岛据此在他人全屏（游戏 / 视频 / 演示 / 浏览器 F11）时自动隐藏，
//! 退出全屏后再恢复显示与置顶，避免常驻 topmost 层级压在全屏内容之上。
//!
//! 设计取舍：只做单次同步查询，不持有任何窗口句柄与全局状态。
//! 轮询节奏由 JS 侧控制，模块本身无状态，避免长期持有 HWND 造成悬垂引用。

use napi_derive::napi;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsIconic,
    IsWindowVisible, WS_MAXIMIZE,
};

/// 全屏判定容差（像素）
///
/// 部分全屏窗口的矩形会比显示器略大（如 -8 起始），或因为 DPI 取整差 1~2 px，
/// 留一点余量避免漏判；但不宜过大，否则会把接近满屏的普通窗口误判成全屏。
const FULLSCREEN_TOLERANCE: i32 = 2;

/// 需要排除的窗口类名
///
/// 这些窗口铺满屏幕但并不代表用户在全屏使用应用：桌面、壁纸层、任务栏。
const EXCLUDED_CLASSES: [&str; 3] = ["Progman", "WorkerW", "Shell_TrayWnd"];

/// 读取窗口类名，失败时返回空字符串
fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// 判断 `outer` 是否完整覆盖 `inner`（允许容差）
fn covers(outer: &RECT, inner: &RECT) -> bool {
    outer.left <= inner.left + FULLSCREEN_TOLERANCE
        && outer.top <= inner.top + FULLSCREEN_TOLERANCE
        && outer.right >= inner.right - FULLSCREEN_TOLERANCE
        && outer.bottom >= inner.bottom - FULLSCREEN_TOLERANCE
}

/// 窗口是否处于最大化状态
///
/// 最大化窗口的矩形同样会覆盖整个显示器（甚至超出屏幕边界），
/// 若不排除会把"最大化"误判成"全屏"，导致灵动岛在用户只是最大化窗口时就消失。
fn is_maximized(hwnd: HWND) -> bool {
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    (style as u32) & WS_MAXIMIZE.0 != 0
}

/// 判断当前前台窗口是否处于全屏
///
/// `exclude_hwnd` 用于排除自身窗口：灵动岛被点击后会成为前台窗口，
/// 不排除会导致"自己把自己判定成全屏"而自我隐藏。
///
/// 返回 `false` 表示当前没有应用处于全屏（或无法判定）。
#[napi]
pub fn is_foreground_fullscreen(exclude_hwnd: Option<i64>) -> bool {
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            return false;
        }
        if exclude_hwnd.is_some_and(|exclude| foreground.0 as isize as i64 == exclude) {
            return false;
        }
        // 最小化 / 不可见的窗口不可能是全屏
        if IsIconic(foreground).as_bool() || !IsWindowVisible(foreground).as_bool() {
            return false;
        }
        // 最大化不算全屏
        if is_maximized(foreground) {
            return false;
        }
        let class = class_name(foreground);
        if EXCLUDED_CLASSES
            .iter()
            .any(|excluded| class.eq_ignore_ascii_case(excluded))
        {
            return false;
        }

        let mut window_rect = RECT::default();
        if GetWindowRect(foreground, &mut window_rect).is_err() {
            return false;
        }

        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return false;
        }
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
            return false;
        }

        covers(&window_rect, &monitor_info.rcMonitor)
    }
}
