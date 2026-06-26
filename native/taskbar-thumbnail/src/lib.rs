//! Windows 任务栏缩略图自定义原生模块
//!
//! 借助 DWM 的 iconic representation，把任务栏悬停缩略图 / Peek 全尺寸预览
//! 替换为指定图片（专辑封面），而非默认的实时窗口内容。
//!
//! 工作原理：对主窗 HWND 打开 `DWMWA_FORCE_ICONIC_REPRESENTATION` +
//! `DWMWA_HAS_ICONIC_BITMAP`，并子类化窗口拦截两条 DWM 消息，被动应答位图。
//! 所有访问都在主线程（NAPI 调用与窗口消息同线程），故用 `thread_local` 保存状态。

use std::cell::RefCell;
use std::ffi::c_void;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP, DwmInvalidateIconicBitmaps,
    DwmSetIconicLivePreviewBitmap, DwmSetIconicThumbnail, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateDIBSection, DIB_RGB_COLORS, DeleteObject, HBITMAP,
    HGDIOBJ,
};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

/// DWM 请求缩略图位图（lParam 低 32 位打包了请求尺寸，宽高顺序与常规相反）
const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;
/// DWM 请求 Peek 全尺寸预览位图
const WM_DWMSENDICONICLIVEPREVIEWBITMAP: u32 = 0x0326;
/// 子类标识
const SUBCLASS_ID: usize = 1;
/// Peek 预览位图的尺寸上限
const PREVIEW_MAX: i32 = 600;

/// 当前封面（BGRA、顶向下、不透明）
struct CoverData {
    bgra: Vec<u8>,
    width: i32,
    height: i32,
}

thread_local! {
    static COVER: RefCell<Option<CoverData>> = const { RefCell::new(None) };
    static TARGET_HWND: RefCell<Option<HWND>> = const { RefCell::new(None) };
}

/// JS 传来的 hwnd 指针转 HWND，并用 `IsWindow` 校验
fn hwnd_from_ptr(ptr: f64) -> Option<HWND> {
    let hwnd = HWND(ptr as usize as *mut c_void);
    // SAFETY: IsWindow 接受任意指针，对非法值返回 false 而非崩溃
    if unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        Some(hwnd)
    } else {
        None
    }
}

/// 等比缩放到 (max_w, max_h) 内的目标尺寸；源已小于上限则原样返回
fn fit(sw: i32, sh: i32, max_w: i32, max_h: i32) -> (i32, i32) {
    if sw <= max_w && sh <= max_h {
        return (sw, sh);
    }
    let scale = (max_w as f32 / sw as f32).min(max_h as f32 / sh as f32);
    (
        ((sw as f32 * scale).round() as i32).max(1),
        ((sh as f32 * scale).round() as i32).max(1),
    )
}

/// 双线性缩放 BGRA
fn scale_bgra(src: &[u8], sw: i32, sh: i32, dw: i32, dh: i32) -> Vec<u8> {
    let (sw, sh) = (sw as usize, sh as usize);
    let (dw, dh) = (dw.max(1) as usize, dh.max(1) as usize);
    let mut dst = vec![0u8; dw * dh * 4];
    for y in 0..dh {
        let fy = if dh > 1 {
            y as f32 * (sh - 1) as f32 / (dh - 1) as f32
        } else {
            0.0
        };
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(sh - 1);
        let wy = fy - y0 as f32;
        for x in 0..dw {
            let fx = if dw > 1 {
                x as f32 * (sw - 1) as f32 / (dw - 1) as f32
            } else {
                0.0
            };
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(sw - 1);
            let wx = fx - x0 as f32;
            let di = (y * dw + x) * 4;
            for c in 0..4 {
                let p00 = src[(y0 * sw + x0) * 4 + c] as f32;
                let p01 = src[(y0 * sw + x1) * 4 + c] as f32;
                let p10 = src[(y1 * sw + x0) * 4 + c] as f32;
                let p11 = src[(y1 * sw + x1) * 4 + c] as f32;
                let top = p00 + (p01 - p00) * wx;
                let bot = p10 + (p11 - p10) * wx;
                dst[di + c] = (top + (bot - top) * wy).round() as u8;
            }
        }
    }
    dst
}

/// 用 BGRA 数据创建顶向下 32bpp DIBSection；返回 HBITMAP（调用方负责 DeleteObject）
unsafe fn create_dib(bgra: &[u8], w: i32, h: i32) -> Option<HBITMAP> {
    let mut bmi: BITMAPINFO = unsafe { std::mem::zeroed() };
    bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h; // 负值 = 顶向下
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let mut bits: *mut c_void = std::ptr::null_mut();
    let hbmp = unsafe { CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) }.ok()?;
    if bits.is_null() {
        let _ = unsafe { DeleteObject(HGDIOBJ(hbmp.0)) };
        return None;
    }
    let len = ((w * h * 4) as usize).min(bgra.len());
    unsafe { std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), len) };
    Some(hbmp)
}

/// 应答一次位图请求：缩放当前封面到目标上限并交给 DWM
unsafe fn provide_bitmap(hwnd: HWND, max_w: i32, max_h: i32, is_preview: bool) {
    COVER.with(|cell| {
        let guard = cell.borrow();
        let Some(cover) = guard.as_ref() else {
            return;
        };
        let (dw, dh) = fit(cover.width, cover.height, max_w, max_h);
        let scaled = if dw == cover.width && dh == cover.height {
            None
        } else {
            Some(scale_bgra(&cover.bgra, cover.width, cover.height, dw, dh))
        };
        let data: &[u8] = scaled.as_deref().unwrap_or(&cover.bgra);
        if let Some(hbmp) = unsafe { create_dib(data, dw, dh) } {
            let _ = if is_preview {
                unsafe { DwmSetIconicLivePreviewBitmap(hwnd, hbmp, None, 0) }
            } else {
                unsafe { DwmSetIconicThumbnail(hwnd, hbmp, 0) }
            };
            let _ = unsafe { DeleteObject(HGDIOBJ(hbmp.0)) };
        }
    });
}

/// 窗口子类过程：仅拦截两条 DWM 位图请求，其余透传
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _ref_data: usize,
) -> LRESULT {
    match msg {
        WM_DWMSENDICONICTHUMBNAIL => {
            // 坑：宽在 HIWORD、高在 LOWORD（与常规相反）
            let packed = lparam.0 as u32;
            let w = (packed >> 16) as i32;
            let h = (packed & 0xFFFF) as i32;
            unsafe { provide_bitmap(hwnd, w, h, false) };
            LRESULT(0)
        }
        WM_DWMSENDICONICLIVEPREVIEWBITMAP => {
            unsafe { provide_bitmap(hwnd, PREVIEW_MAX, PREVIEW_MAX, true) };
            LRESULT(0)
        }
        _ => unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
    }
}

/// 开启 DWM 布尔属性
unsafe fn enable_dwm_flag(hwnd: HWND, attr: windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE) {
    let value: i32 = 1;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attr,
            std::ptr::addr_of!(value).cast::<c_void>(),
            size_of::<i32>() as u32,
        )
    };
}

/// 开启自定义缩略图：设置 DWM 属性并子类化窗口
#[napi]
pub fn enable(hwnd_ptr: f64) -> bool {
    let Some(hwnd) = hwnd_from_ptr(hwnd_ptr) else {
        return false;
    };
    unsafe {
        enable_dwm_flag(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION);
        enable_dwm_flag(hwnd, DWMWA_HAS_ICONIC_BITMAP);
        let ok = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0).as_bool();
        if ok {
            TARGET_HWND.with(|cell| *cell.borrow_mut() = Some(hwnd));
        }
        ok
    }
}

/// 更新封面（BGRA、顶向下、不透明），并让 DWM 失效以重新拉取
#[napi]
pub fn set_cover(bgra: Buffer, width: i32, height: i32) {
    let bytes = bgra.to_vec();
    if width <= 0 || height <= 0 || bytes.len() < (width * height * 4) as usize {
        return;
    }
    COVER.with(|cell| {
        *cell.borrow_mut() = Some(CoverData {
            bgra: bytes,
            width,
            height,
        });
    });
    invalidate();
}

fn invalidate() {
    TARGET_HWND.with(|cell| {
        if let Some(hwnd) = *cell.borrow() {
            let _ = unsafe { DwmInvalidateIconicBitmaps(hwnd) };
        }
    });
}
