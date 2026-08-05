use anyhow::{Context, Result};
use windows::Win32::{
    Foundation::{GetLastError, HWND, RECT, SetLastError, WIN32_ERROR},
    UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GWL_STYLE, GetParent, GetWindowLongPtrW, GetWindowRect, MoveWindow, SetParent,
        SetWindowLongPtrW, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CAPTION, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
        WS_THICKFRAME,
    },
};

mod win10;
mod win11;

pub(super) struct EmbeddedWindow {
    child: HWND,
    original_parent: HWND,
    original_style: isize,
    original_ex_style: isize,
    original_rect: RECT,
}

fn read_window_long(
    child: HWND,
    index: windows::Win32::UI::WindowsAndMessaging::WINDOW_LONG_PTR_INDEX,
) -> Result<isize> {
    // SAFETY: child 是已验证窗口，index 只允许 style/ex-style；清零 last error 用于区分合法的 0。
    unsafe { SetLastError(WIN32_ERROR(0)) };
    // SAFETY: 同上，只读取窗口字段。
    let value = unsafe { GetWindowLongPtrW(child, index) };
    // SAFETY: 仅读取线程 last error。
    let error = unsafe { GetLastError() };
    anyhow::ensure!(
        value != 0 || error == WIN32_ERROR(0),
        "读取窗口样式失败: {error:?}"
    );
    Ok(value)
}

fn write_window_long(
    child: HWND,
    index: windows::Win32::UI::WindowsAndMessaging::WINDOW_LONG_PTR_INDEX,
    value: isize,
) -> Result<()> {
    // SAFETY: child 是已验证窗口，value 对应此前读取并计算的 style/ex-style。
    unsafe { SetLastError(WIN32_ERROR(0)) };
    // SAFETY: 同上，仅修改窗口样式字段。
    let previous = unsafe { SetWindowLongPtrW(child, index, value) };
    // SAFETY: 仅读取线程 last error。
    let error = unsafe { GetLastError() };
    anyhow::ensure!(
        previous != 0 || error == WIN32_ERROR(0),
        "写入窗口样式失败: {error:?}"
    );
    Ok(())
}

impl EmbeddedWindow {
    /// 保存窗口原始状态后嵌入任务栏；任一步失败都会恢复已修改字段。
    pub fn attach(child: HWND, parent: HWND) -> Result<Self> {
        anyhow::ensure!(
            !child.0.is_null() && !parent.0.is_null(),
            "嵌入窗口句柄为空"
        );
        // SAFETY: child 是 Electron 提供并经 IsWindow 验证的句柄。
        let original_parent = unsafe { GetParent(child) }.unwrap_or_default();
        let original_style = read_window_long(child, GWL_STYLE)?;
        let original_ex_style = read_window_long(child, GWL_EXSTYLE)?;
        let mut original_rect = RECT::default();
        // SAFETY: child 有效，RECT 是匹配的可写出参。
        unsafe { GetWindowRect(child, &raw mut original_rect) }.context("读取嵌入窗口矩形失败")?;

        let mut attachment = Self {
            child,
            original_parent,
            original_style,
            original_ex_style,
            original_rect,
        };
        let result = (|| {
            // SAFETY: child/parent 均为有效窗口，调用发生在 taskbar owner thread。
            unsafe { SetParent(child, Some(parent)) }.context("设置任务栏歌词父窗口失败")?;
            let style = WINDOW_STYLE(original_style as u32);
            let mask = WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;
            write_window_long(child, GWL_STYLE, (style & !mask).0 as isize)?;
            let ex_style = WINDOW_EX_STYLE(original_ex_style as u32);
            write_window_long(
                child,
                GWL_EXSTYLE,
                (ex_style | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE).0 as isize,
            )?;
            Ok(())
        })();
        if let Err(error) = result {
            attachment.restore();
            return Err(error);
        }
        Ok(attachment)
    }

    pub fn restore(&mut self) {
        if self.child.0.is_null() {
            return;
        }
        // SAFETY: child 原状态由 attach 从同一窗口读取；窗口失效时 Win32 返回错误并被安全忽略。
        unsafe {
            let parent = (!self.original_parent.0.is_null()).then_some(self.original_parent);
            let _ = SetParent(self.child, parent);
            let _ = write_window_long(self.child, GWL_STYLE, self.original_style);
            let _ = write_window_long(self.child, GWL_EXSTYLE, self.original_ex_style);
            let _ = MoveWindow(
                self.child,
                self.original_rect.left,
                self.original_rect.top,
                self.original_rect.right - self.original_rect.left,
                self.original_rect.bottom - self.original_rect.top,
                true,
            );
        }
        self.child = HWND::default();
    }
}

impl Drop for EmbeddedWindow {
    fn drop(&mut self) {
        self.restore();
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
    fn embed_window(&mut self, child_hwnd: HWND) -> bool;
    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout>;
    fn restore(&mut self);
}

#[cfg(test)]
mod tests {
    use super::Rect;

    #[test]
    fn rect_union_preserves_negative_monitor_coordinates() {
        let mut rect = Rect {
            x: -1920,
            y: 0,
            width: 960,
            height: 40,
        };
        rect.union(&Rect {
            x: -960,
            y: -20,
            width: 960,
            height: 60,
        });
        assert_eq!(rect.x, -1920);
        assert_eq!(rect.y, -20);
        assert_eq!(rect.width, 1920);
        assert_eq!(rect.height, 60);
    }

    #[test]
    fn rect_union_ignores_empty_bounds() {
        let mut rect = Rect {
            x: 10,
            y: 20,
            width: 30,
            height: 40,
        };
        rect.union(&Rect::default());
        assert_eq!(rect.x, 10);
        assert_eq!(rect.y, 20);
        assert_eq!(rect.width, 30);
        assert_eq!(rect.height, 40);
    }
}
