use windows::Win32::Foundation::HWND;

mod win10;
mod win11;

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
}

#[derive(Debug, Clone, Copy)]
pub struct TaskbarLayout {
    pub space: AvailableSpace,
    pub extra: ExtraLayoutInfo,
}

pub trait TaskbarStrategy {
    fn init(&mut self) -> bool;
    fn embed_window(&self, child_hwnd: HWND) -> bool;
    fn update_layout(&mut self, params: LayoutParams) -> Option<TaskbarLayout>;
    fn restore(&self);
}
