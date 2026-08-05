//! Windows 任务栏缩略图自定义原生模块。
//!
//! 每个 `ThumbnailService` 只挂接一个 HWND。实例上下文通过 subclass `dwRefData`
//! 传给 WndProc，不使用进程全局或 thread-local callback 状态。

use std::cell::RefCell;
use std::ffi::c_void;

use napi::bindgen_prelude::{Buffer, Error, Result};
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
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::{
    System::Threading::GetCurrentThreadId,
    UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow, WM_NCDESTROY},
};

const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;
const WM_DWMSENDICONICLIVEPREVIEWBITMAP: u32 = 0x0326;
const SUBCLASS_ID: usize = 1;
const MAX_COVER_EDGE: i32 = 4096;

#[napi(object)]
pub struct JsBitmapVariant {
    pub bgra: Buffer,
    pub width: i32,
    pub height: i32,
}

struct OwnedBitmap(isize);

impl OwnedBitmap {
    fn handle(&self) -> HBITMAP {
        HBITMAP(self.0 as *mut c_void)
    }
}

impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        // SAFETY: 句柄由 CreateDIBSection 创建并只转移到此 OwnedBitmap，恰好释放一次。
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.0 as *mut c_void));
        }
    }
}

struct BitmapVariant {
    bitmap: OwnedBitmap,
    width: i32,
    height: i32,
}

#[derive(Default)]
struct ThumbnailContext {
    hwnd: usize,
    variants: Vec<BitmapVariant>,
}

impl ThumbnailContext {
    fn hwnd(&self) -> Option<HWND> {
        (self.hwnd != 0).then_some(HWND(self.hwnd as *mut c_void))
    }
}

fn required_bgra_len(width: i32, height: i32) -> Result<usize> {
    if width <= 0 || height <= 0 {
        return Err(Error::from_reason("封面尺寸必须为正数"));
    }
    if width > MAX_COVER_EDGE || height > MAX_COVER_EDGE {
        return Err(Error::from_reason("封面尺寸不得超过 4096px"));
    }
    usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| Error::from_reason("封面尺寸溢出"))
}

fn hwnd_from_buffer(buffer: &[u8]) -> Result<HWND> {
    let pointer_width = size_of::<usize>();
    if buffer.len() != pointer_width {
        return Err(Error::from_reason("HWND Buffer 长度与当前指针宽度不一致"));
    }
    let value = if pointer_width == 8 {
        usize::try_from(u64::from_le_bytes(
            buffer
                .try_into()
                .map_err(|_| Error::from_reason("读取 64 位 HWND Buffer 失败"))?,
        ))
        .map_err(|_| Error::from_reason("HWND 超出当前平台指针范围"))?
    } else {
        usize::try_from(u32::from_le_bytes(
            buffer
                .try_into()
                .map_err(|_| Error::from_reason("读取 32 位 HWND Buffer 失败"))?,
        ))
        .map_err(|_| Error::from_reason("HWND 超出当前平台指针范围"))?
    };
    if value == 0 {
        return Err(Error::from_reason("HWND 不能为空"));
    }
    let hwnd = HWND(value as *mut c_void);
    // SAFETY: IsWindow 接受任意 HWND 值，非法窗口返回 false。
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err(Error::from_reason("HWND 不是有效窗口"));
    }
    Ok(hwnd)
}

unsafe fn create_dib(bgra: &[u8], width: i32, height: i32) -> Result<OwnedBitmap> {
    let required = required_bgra_len(width, height)?;
    if bgra.len() != required {
        return Err(Error::from_reason("封面 BGRA 字节数与尺寸不匹配"));
    }
    // SAFETY: BITMAPINFO 是纯 C 数据结构，零初始化后立即填写全部必要字段。
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;

    let mut bits = std::ptr::null_mut();
    // SAFETY: info 已完整初始化，bits 是有效出参；返回句柄立即交给 OwnedBitmap。
    let bitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }
        .map_err(|error| Error::from_reason(format!("创建封面 DIB 失败: {error}")))?;
    if bits.is_null() {
        // SAFETY: bitmap 刚由 CreateDIBSection 创建，失败返回前释放。
        unsafe {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
        return Err(Error::from_reason("CreateDIBSection 未返回像素地址"));
    }
    // SAFETY: bits 指向 required 字节的 DIB 可写区域，bgra 已经过精确长度校验。
    unsafe { std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), required) };
    Ok(OwnedBitmap(bitmap.0 as isize))
}

unsafe fn set_dwm_flag(
    hwnd: HWND,
    attribute: windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE,
    enabled: bool,
) -> bool {
    let value: i32 = i32::from(enabled);
    // SAFETY: value 指针和长度与 DWM 布尔属性要求的 i32 一致。
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            std::ptr::addr_of!(value).cast::<c_void>(),
            size_of::<i32>() as u32,
        )
    }
    .is_ok()
}

unsafe fn provide_bitmap(
    context: &ThumbnailContext,
    hwnd: HWND,
    max_width: i32,
    max_height: i32,
    preview: bool,
) {
    let variant = if preview {
        context.variants.last()
    } else {
        context
            .variants
            .iter()
            .rev()
            .find(|variant| variant.width <= max_width && variant.height <= max_height)
    };
    let Some(variant) = variant else {
        return;
    };
    if preview {
        // SAFETY: hwnd 来自当前消息，位图在 context 生命周期内有效。
        let _ = unsafe { DwmSetIconicLivePreviewBitmap(hwnd, variant.bitmap.handle(), None, 0) };
    } else {
        // SAFETY: 位图不超过 DWM 请求尺寸，句柄在调用期间有效。
        let _ = unsafe { DwmSetIconicThumbnail(hwnd, variant.bitmap.handle(), 0) };
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    reference_data: usize,
) -> LRESULT {
    if reference_data == 0 {
        // SAFETY: 无实例上下文时必须交给默认子类过程。
        return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    }
    // SAFETY: reference_data 指向 ThumbnailService 持有的稳定 Box；detach 在释放 Box 前先移除 subclass。
    let context = unsafe { &mut *(reference_data as *mut ThumbnailContext) };
    match message {
        WM_DWMSENDICONICTHUMBNAIL => {
            let packed = lparam.0 as u32;
            let width = (packed >> 16) as i32;
            let height = (packed & 0xFFFF) as i32;
            // SAFETY: 参数直接来自 DWM，context 由 subclass ref data 保证有效。
            unsafe { provide_bitmap(context, hwnd, width, height, false) };
            LRESULT(0)
        }
        WM_DWMSENDICONICLIVEPREVIEWBITMAP => {
            // SAFETY: hwnd/context 均属于当前 subclass 调用。
            unsafe { provide_bitmap(context, hwnd, i32::MAX, i32::MAX, true) };
            LRESULT(0)
        }
        WM_NCDESTROY => {
            context.hwnd = 0;
            context.variants.clear();
            // SAFETY: WM_NCDESTROY 仍需交给默认子类过程完成窗口销毁。
            unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
        }
        // SAFETY: 未处理消息必须交给系统默认子类过程。
        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

#[napi]
pub struct ThumbnailService {
    owner_thread_id: u32,
    context: RefCell<Box<ThumbnailContext>>,
}

#[napi]
impl ThumbnailService {
    #[napi(constructor)]
    pub fn new(hwnd_buffer: Buffer) -> Result<Self> {
        let hwnd = hwnd_from_buffer(hwnd_buffer.as_ref())?;
        // SAFETY: 只读取当前线程 ID。
        let owner_thread_id = unsafe { GetCurrentThreadId() };
        // SAFETY: hwnd 已由 IsWindow 验证，且不请求进程 ID 出参。
        let window_thread_id = unsafe { GetWindowThreadProcessId(hwnd, None) };
        if window_thread_id == 0 || window_thread_id != owner_thread_id {
            return Err(Error::from_reason(
                "ThumbnailService 必须在目标窗口 owner 线程构造",
            ));
        }

        let mut context = Box::new(ThumbnailContext {
            hwnd: hwnd.0 as usize,
            variants: Vec::new(),
        });
        let context_ptr = std::ptr::from_mut(context.as_mut()) as usize;
        // SAFETY: 所有窗口操作均发生在已验证的 owner thread；失败时完整回滚 DWM flags。
        unsafe {
            if !set_dwm_flag(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, true)
                || !set_dwm_flag(hwnd, DWMWA_HAS_ICONIC_BITMAP, true)
            {
                set_dwm_flag(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, false);
                set_dwm_flag(hwnd, DWMWA_HAS_ICONIC_BITMAP, false);
                return Err(Error::from_reason("启用 DWM iconic representation 失败"));
            }
            if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, context_ptr).as_bool() {
                set_dwm_flag(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, false);
                set_dwm_flag(hwnd, DWMWA_HAS_ICONIC_BITMAP, false);
                return Err(Error::from_reason("安装任务栏缩略图 subclass 失败"));
            }
        }

        Ok(Self {
            owner_thread_id,
            context: RefCell::new(context),
        })
    }

    /// 用 TypeScript 预缩放的 BGRA buckets 原子替换全部 DIB，WndProc 不再缩放或分配。
    #[napi]
    pub fn set_cover_variants(&self, variants: Vec<JsBitmapVariant>) -> Result<()> {
        self.ensure_owner_thread()?;
        if variants.is_empty() {
            return Err(Error::from_reason("至少需要一个封面尺寸 variant"));
        }
        let mut prepared = Vec::with_capacity(variants.len());
        for variant in variants {
            let required = required_bgra_len(variant.width, variant.height)?;
            if variant.bgra.len() != required {
                return Err(Error::from_reason("封面 BGRA 字节数与尺寸不匹配"));
            }
            // SAFETY: BGRA 长度已严格验证，返回句柄立即由 OwnedBitmap 管理。
            let bitmap =
                unsafe { create_dib(variant.bgra.as_ref(), variant.width, variant.height) }?;
            prepared.push(BitmapVariant {
                bitmap,
                width: variant.width,
                height: variant.height,
            });
        }
        prepared.sort_by_key(|variant| i64::from(variant.width) * i64::from(variant.height));
        let hwnd = {
            let mut context = self.context.borrow_mut();
            context.variants = prepared;
            context.hwnd()
        };
        if let Some(hwnd) = hwnd {
            // SAFETY: hwnd 仍由当前实例挂接且调用发生在 owner thread。
            unsafe { DwmInvalidateIconicBitmaps(hwnd) }
                .map_err(|error| Error::from_reason(format!("刷新 DWM 缩略图失败: {error}")))?;
        }
        Ok(())
    }

    /// 恢复系统默认窗口预览。重复调用无害。
    #[napi]
    pub fn disable(&self) -> Result<()> {
        self.ensure_owner_thread()?;
        self.detach();
        Ok(())
    }

    fn ensure_owner_thread(&self) -> Result<()> {
        // SAFETY: 只读取当前线程 ID。
        let current = unsafe { GetCurrentThreadId() };
        if current != self.owner_thread_id {
            return Err(Error::from_reason(
                "ThumbnailService 方法必须在目标窗口 owner 线程调用",
            ));
        }
        Ok(())
    }

    fn detach(&self) {
        let mut context = self.context.borrow_mut();
        if let Some(hwnd) = context.hwnd() {
            // SAFETY: hwnd/context 由本实例安装，且调用方已保证在 owner thread。
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
                set_dwm_flag(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, false);
                set_dwm_flag(hwnd, DWMWA_HAS_ICONIC_BITMAP, false);
            }
            context.hwnd = 0;
        }
        context.variants.clear();
    }
}

impl Drop for ThumbnailService {
    fn drop(&mut self) {
        // N-API finalizer 与该同步实例的方法运行在同一 Node 环境线程；若环境异常销毁导致线程不同，
        // Windows 禁止跨线程移除 subclass，此时窗口销毁会通过 WM_NCDESTROY 清理关联。
        // SAFETY: 只读取当前线程 ID。
        if self.owner_thread_id == unsafe { GetCurrentThreadId() } {
            self.detach();
        }
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::System::Threading::{GR_GDIOBJECTS, GetCurrentProcess, GetGuiResources};

    use super::{create_dib, required_bgra_len};

    #[test]
    fn validates_exact_bgra_lengths_with_checked_arithmetic() {
        assert_eq!(required_bgra_len(256, 128).unwrap(), 256 * 128 * 4);
        assert!(required_bgra_len(0, 1).is_err());
        assert!(required_bgra_len(-1, 1).is_err());
        assert!(required_bgra_len(i32::MAX, i32::MAX).is_err());
    }

    #[test]
    fn repeated_dib_replacement_does_not_leak_gdi_handles() {
        let bgra = vec![0_u8; 16 * 16 * 4];
        // 测试进程最初可能没有任何 GDI 对象，保留一个基准 DIB 以区分查询失败和合法的零值。
        // SAFETY: 测试数据长度与 16x16 BGRA 严格一致。
        let sentinel = unsafe { create_dib(&bgra, 16, 16) }.expect("创建基准 DIB 失败");
        // SAFETY: 仅查询当前进程拥有的 GDI 对象数量。
        let before = unsafe { GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) };
        assert!(before > 0, "无法读取当前进程 GDI 资源计数");
        for _ in 0..1_000 {
            // SAFETY: 测试数据长度与 16x16 BGRA 严格一致，OwnedBitmap 在本轮结束时释放。
            let bitmap = unsafe { create_dib(&bgra, 16, 16) }.expect("创建测试 DIB 失败");
            drop(bitmap);
        }
        // SAFETY: 仅查询当前进程拥有的 GDI 对象数量。
        let after = unsafe { GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) };
        assert!(
            after <= before + 1,
            "DIB 压测后 GDI 对象持续增长: before={before}, after={after}"
        );
        drop(sentinel);
    }
}
