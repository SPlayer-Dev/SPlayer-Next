use std::mem::size_of;
use std::time::{Duration, Instant};

use windows::{
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::{GetMonitorInfoW, MONITORINFO, MonitorFromWindow, MONITOR_DEFAULTTONEAREST},
        UI::WindowsAndMessaging::{FindWindowExW, GetWindowRect},
    },
    core::w,
};

use crate::{
    strategy::{
        AvailableSpace, ExtraLayoutInfo, LayoutParams, Rect, SystemType, TaskbarLayout,
        TaskbarStrategy,
    },
    uia::{TaskbarContentBounds, TaskbarScanner},
    utils::{BRIDGE_CLASS, check_registry_value, find_taskbar_hwnd, read_system_uses_light_theme},
};

/// 视为任务栏完整可见的相交面积占比；低于该值说明处于自动隐藏的滑动/隐藏状态
const FULL_VISIBLE_RATIO: f32 = 0.99;

/// 自动隐藏收起后，任务栏在屏幕边缘仅保留约 2px 的鼠标唤醒触发带；
/// 可见厚度不超过该阈值时将空间宽高置 0 让 JS 端收起歌词窗口，避免窗口盖住唤醒带导致无法唤出任务栏
const AUTOHIDE_COLLAPSED_MAX_PX: i32 = 4;

/// 任务栏矩形不变时缓存的重扫周期
///
/// UIA 整树扫描单次耗时上百毫秒；稳态下每次 Update 都重扫会占满 worker，
/// 滑动动画的帧只能排队等待。横向边界只随任务栏内部布局变化，用周期重扫兜底
const SCAN_REFRESH_INTERVAL: Duration = Duration::from_millis(2000);

/// 任务栏内容横向边界相对任务栏左边缘的偏移
///
/// 自动隐藏的滑动动画由 LOCATIONCHANGE 每帧驱动，任务栏矩形每帧都在平移；动画期间
/// UIA 扫描慢且在树抖动期容易失败，复用上次完整可见时扫描到的横向边界、只跟随当前
/// 矩形位置，歌词才能按帧贴住任务栏滑出/滑回
#[derive(Debug, Clone, Copy)]
struct ScanCache {
    content_left: i32,
    content_width: i32,
    widgets_left: i32,
    widgets_width: i32,
}

impl ScanCache {
    fn from_bounds(bounds: &TaskbarContentBounds, tb_rect: RECT) -> Self {
        Self {
            content_left: bounds.content.x - tb_rect.left,
            content_width: bounds.content.width,
            widgets_left: bounds.widgets.x - tb_rect.left,
            widgets_width: bounds.widgets.width,
        }
    }
}

pub struct Win11Strategy {
    h_taskbar: HWND,
    scanner: Option<TaskbarScanner>,
    /// 最近一次完整可见时扫描到的横向边界；滑动/隐藏期间作为布局缓存
    scan_cache: Option<ScanCache>,
    /// 最近一次布局使用的任务栏矩形，用于识别滑动动画中的逐帧位移
    last_tb_rect: Option<RECT>,
    /// 最近一次 UIA 扫描对应的任务栏矩形与时间；矩形未变且缓存新鲜时跳过重扫
    last_scan_rect: Option<RECT>,
    last_scan_at: Option<Instant>,
}

impl Win11Strategy {
    pub fn new() -> Self {
        Self {
            h_taskbar: HWND::default(),
            scanner: None,
            scan_cache: None,
            last_tb_rect: None,
            last_scan_rect: None,
            last_scan_at: None,
        }
    }

    fn is_taskbar_center_align() -> bool {
        check_registry_value("TaskbarAl", |val| val == 1, true)
    }

    /// 任务栏与所属显示器相交的（面积占比, 可见高度px）
    fn monitor_visibility(hwnd: HWND, tb_rect: RECT) -> (f32, i32) {
        let tb_h = (tb_rect.bottom - tb_rect.top).max(1);
        let tb_w = (tb_rect.right - tb_rect.left).max(1);
        // SAFETY: 两个 API 对失效句柄/显示器返回失败或默认值，不产生越界访问
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &raw mut info).as_bool() {
                return (1.0, tb_h);
            }
            let monitor_rect = info.rcMonitor;
            let width =
                (tb_rect.right.min(monitor_rect.right) - tb_rect.left.max(monitor_rect.left)).max(0);
            let height =
                (tb_rect.bottom.min(monitor_rect.bottom) - tb_rect.top.max(monitor_rect.top)).max(0);
            let full_area = (tb_w * tb_h).max(1);
            ((width * height) as f32 / full_area as f32, height)
        }
    }

    /// 扫描结果合理性：内容区宽度为正且不超出任务栏宽度
    ///
    /// 内容横向偏移是任务栏平移的不变量，任意可见状态下扫描都可用；
    /// 但收起态 UIA 可能返回退化布局，宽度异常的结果不可信、不入缓存
    fn cacheable(scan: &ScanCache, tb_rect: RECT) -> bool {
        let tb_width = tb_rect.right - tb_rect.left;
        scan.content_width > 0 && scan.content_width <= tb_width
    }

    /// 无缓存时补一次扫描建立缓存，仅成功且结果合理时生效
    ///
    /// 应用启动时任务栏常处于收起态，不预建缓存的话首次展开动画期间只能走 UIA 慢路径，
    /// 动画结束后才一次性跳变
    fn seed_cache(&mut self, tb_rect: RECT) {
        if self.scanner.is_none() {
            match TaskbarScanner::new() {
                Ok(s) => self.scanner = Some(s),
                Err(_) => return,
            }
        }
        let Some(scanner) = self.scanner.as_ref() else {
            return;
        };
        if let Ok(bounds) = scanner.scan_taskbar(self.h_taskbar) {
            let scan = ScanCache::from_bounds(&bounds, tb_rect);
            if Self::cacheable(&scan, tb_rect) {
                self.scan_cache = Some(scan);
                self.last_scan_rect = Some(tb_rect);
                self.last_scan_at = Some(Instant::now());
            }
        }
    }

    /// 任务栏完全收起时返回宽高为 0 的空布局，触发 JS 侧 parkWindow 停靠，让出屏幕底缘的唤醒触发带
    fn empty_layout(is_centered: bool) -> TaskbarLayout {
        TaskbarLayout {
            space: AvailableSpace::default(),
            extra: ExtraLayoutInfo {
                system_type: SystemType::Win11,
                is_centered,
                is_light: read_system_uses_light_theme(),
            },
        }
    }

    /// 用给定的横向边界与当前任务栏矩形组装布局，滑动动画期间只随矩形平移
    fn build_layout(
        tb_rect: RECT,
        scan: ScanCache,
        tray_rect: Rect,
        is_centered: bool,
    ) -> TaskbarLayout {
        let tb_height = tb_rect.bottom - tb_rect.top;

        let content_left = tb_rect.left + scan.content_left;
        let content_right = content_left + scan.content_width;
        let widgets_left = tb_rect.left + scan.widgets_left;

        let left_x = if scan.widgets_width > 0 && widgets_left < content_left {
            widgets_left + scan.widgets_width
        } else {
            tb_rect.left
        };

        let left_width = (content_left - left_x).max(0);

        let left_space = Rect {
            x: left_x,
            y: tb_rect.top,
            width: left_width,
            height: tb_height,
        };

        let right_x = content_right;

        let right_right_edge = if scan.widgets_width > 0 && widgets_left > content_right {
            widgets_left
        } else if tray_rect.width > 0 {
            tray_rect.x
        } else {
            tb_rect.right
        };

        let right_width = (right_right_edge - right_x).max(0);

        let right_space = Rect {
            x: right_x,
            y: tb_rect.top,
            width: right_width,
            height: tb_height,
        };

        TaskbarLayout {
            space: AvailableSpace {
                left: left_space,
                right: right_space,
            },
            extra: ExtraLayoutInfo {
                system_type: SystemType::Win11,
                is_centered,
                is_light: read_system_uses_light_theme(),
            },
        }
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
        super::embed_child_window(child_wnd, self.h_taskbar)
    }

    fn taskbar_hwnd(&self) -> HWND {
        self.h_taskbar
    }

    fn update_layout(&mut self, _params: LayoutParams) -> Option<TaskbarLayout> {
        if self.h_taskbar.0.is_null() {
            return None;
        }

        let mut tb_rect = RECT::default();
        if unsafe { GetWindowRect(self.h_taskbar, &raw mut tb_rect) }.is_err() {
            return None;
        }

        let is_centered = Self::is_taskbar_center_align();
        let (vis_ratio, vis_height) = Self::monitor_visibility(self.h_taskbar, tb_rect);

        // 任务栏已收起到底缘（只剩 ~2px 唤醒触发带）：直接返回空布局让 JS hide 窗口，
        // 避免歌词窗口停在 T=1150 盖住底缘 2px 导致鼠标无法唤出任务栏
        if vis_height <= AUTOHIDE_COLLAPSED_MAX_PX {
            self.last_tb_rect = Some(tb_rect);
            // 应用启动时任务栏常已处于收起态，趁机预建缓存，首次展开动画即可走快速路径
            if self.scan_cache.is_none() {
                self.seed_cache(tb_rect);
            }
            return Some(Self::empty_layout(is_centered));
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

        // 滑动动画期间（矩形逐帧变化或未完整可见）不跑 UIA 扫描：扫描耗时超过帧间隔，
        // 且树抖动期容易失败，会导致整段动画期间不 emit。复用上次完整可见时的横向边界，
        // 只跟随当前矩形平移，歌词即可按帧贴住任务栏
        let sliding = self.last_tb_rect.is_some_and(|prev| prev != tb_rect);
        if let Some(scan) = self.scan_cache
            && (sliding || vis_ratio < FULL_VISIBLE_RATIO)
        {
            self.last_tb_rect = Some(tb_rect);
            return Some(Self::build_layout(tb_rect, scan, tray_rect, is_centered));
        }

        // 矩形没变说明任务栏内部布局也没变：复用缓存直接布局，避免稳态下每次 Update
        // 都跑上百毫秒的整树扫描、占住 worker 导致动画帧排队；内部布局变化由周期重扫兜底
        if let Some(scan) = self.scan_cache
            && self.last_scan_rect.is_some_and(|prev| prev == tb_rect)
            && self
                .last_scan_at
                .is_some_and(|at| at.elapsed() < SCAN_REFRESH_INTERVAL)
        {
            self.last_tb_rect = Some(tb_rect);
            return Some(Self::build_layout(tb_rect, scan, tray_rect, is_centered));
        }

        if self.scanner.is_none() {
            match TaskbarScanner::new() {
                Ok(s) => self.scanner = Some(s),
                Err(_) => {
                    error!("Scanner 初始化失败");
                    self.last_tb_rect = Some(tb_rect);
                    return self
                        .scan_cache
                        .map(|scan| Self::build_layout(tb_rect, scan, tray_rect, is_centered));
                }
            }
        }

        let bounds = match self.scanner.as_ref().map(|s| s.scan_taskbar(self.h_taskbar)) {
            Some(Ok(bounds)) => bounds,
            _ => {
                error!("scan_taskbar 失败");
                self.scanner = None;
                self.last_tb_rect = Some(tb_rect);
                return self
                    .scan_cache
                    .map(|scan| Self::build_layout(tb_rect, scan, tray_rect, is_centered));
            }
        };

        let scan = ScanCache::from_bounds(&bounds, tb_rect);
        // 扫描成功且结果合理即入缓存——内容横向偏移不随任务栏滑动变化，
        // 收起/滑动中的扫描同样可信；退化结果由 cacheable 挡掉
        if Self::cacheable(&scan, tb_rect) {
            self.scan_cache = Some(scan);
            self.last_scan_rect = Some(tb_rect);
            self.last_scan_at = Some(Instant::now());
        }
        self.last_tb_rect = Some(tb_rect);

        Some(Self::build_layout(tb_rect, scan, tray_rect, is_centered))
    }

    fn restore(&self) {}
}

impl Drop for Win11Strategy {
    fn drop(&mut self) {
        self.restore();
    }
}

