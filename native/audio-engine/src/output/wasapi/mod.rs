//! Windows WASAPI 独占模式输出，绕过系统混音器，保留播放器 DSP 链路。
//!
//! 与共享模式（cpal）互斥：协商成功的格式即解码重采样目标，
//! 渲染线程以事件驱动方式从 `DecoderSource` 拉取 f32 样本，
//! 按协商位深转成整型交给声卡。设备被其他程序独占或格式不支持时，
//! 协商阶段返回带稳定分类的错误，由调用方回退共享模式。

#![cfg(target_os = "windows")]

mod format;
mod pcm;
pub use format::negotiate_exclusive_format;
use format::{build_wave_format, resolve_endpoint};
use pcm::fill_buffer;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tracing::{debug, info, warn};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_EVENT, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_E_DEVICE_IN_USE,
    AUDCLNT_E_UNSUPPORTED_FORMAT, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE};

use crate::decoder::transition_source::TransitionSource as DecoderSource;

/// 渲染等待句柄索引：关闭信号
const SHUTDOWN_EVENT_INDEX: u32 = 1;

/// 独占模式协商出的输出格式
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExclusiveFormat {
    /// 采样率（Hz）
    pub sample_rate: u32,
    /// 声道数
    pub channels: u16,
    /// 容器位深（16 / 32）
    pub container_bits: u16,
    /// 有效位深（16 / 24 / 32）
    pub valid_bits: u16,
}

/// 独占模式打开失败分类，调用方据此决定回退提示文案
#[derive(Debug, thiserror::Error)]
pub enum ExclusiveOpenError {
    /// 设备已被其他程序独占
    #[error("device in use")]
    DeviceInUse,
    /// 设备不接受任何候选格式
    #[error("format unsupported")]
    FormatUnsupported,
    /// 端点解析或其他系统错误
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl ExclusiveOpenError {
    /// 回退原因分类键，JS 侧按此取 i18n 文案
    pub fn reason(&self) -> &'static str {
        match self {
            Self::DeviceInUse => "deviceBusy",
            Self::FormatUnsupported => "formatUnsupported",
            Self::Other(_) => "unavailable",
        }
    }
}

/// 内核事件句柄包装：HANDLE 在 windows-rs 中为裸指针（!Send/!Sync），
/// 但句柄仅用于 SetEvent / CloseHandle / WaitForMultipleObjects 等线程安全的内核调用
#[derive(Clone, Copy)]
struct EventHandle(HANDLE);

unsafe impl Send for EventHandle {}
unsafe impl Sync for EventHandle {}

impl EventHandle {
    fn set(&self) {
        unsafe {
            let _ = SetEvent(self.0);
        }
    }

    fn close(&self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// COM 接口指针包装：windows-rs 接口默认 !Send；
/// 本模块运行在 MTA，接口调用无 apartment 亲和性，跨线程移动安全
struct ComSend<T>(T);

unsafe impl<T> Send for ComSend<T> {}

/// 先释放渲染线程持有的 COM 接口，再退出 apartment。
struct RenderApartment;

impl Drop for RenderApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// 渲染线程等待用句柄对守卫：中途出错时保证关闭
struct EventHandles(EventHandle, EventHandle);

impl Drop for EventHandles {
    fn drop(&mut self) {
        self.0.close();
        self.1.close();
    }
}

/// 独占模式输出流：事件驱动渲染线程 + WASAPI 独占客户端。
/// 暂停/停止通过共享原子标志生效于下一个设备周期（约 10ms），无 COM 并发调用
pub struct ExclusiveStream {
    /// 保持 COM 客户端存活，Drop 时由渲染线程退出后统一 Stop
    client: Option<IAudioClient>,
    /// 设备周期事件（自动重置）
    period_event: EventHandle,
    /// 渲染线程关闭信号（手动重置）
    shutdown_event: EventHandle,
    render_thread: Option<JoinHandle<()>>,
    paused: Arc<AtomicBool>,
}

// 句柄经 EventHandle 包装（内核等待/信号调用线程安全）；
// IAudioClient 为 MTA 内的 COM 接口指针，可跨线程调用；
// paused 由渲染线程独占读写语义之外的原子标志，仅作静音开关
unsafe impl Send for ExclusiveStream {}
unsafe impl Sync for ExclusiveStream {}

impl ExclusiveStream {
    /// 恢复输出
    pub fn play(&self) {
        self.paused.store(false, Ordering::Release);
    }

    /// 暂停输出（下一周期起静音）
    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
    }
}

impl Drop for ExclusiveStream {
    fn drop(&mut self) {
        self.shutdown_event.set();
        if let Some(handle) = self.render_thread.take() {
            let _ = handle.join();
        }
        if let Some(client) = self.client.take() {
            unsafe {
                let _ = client.Stop();
            }
        }
        drop(EventHandles(self.period_event, self.shutdown_event));
        debug!("独占模式输出流已释放");
    }
}

/// 按协商格式创建独占模式输出流
///
/// # Arguments
/// * `device_id` - cpal 设备 ID 字符串，`None` 走系统默认端点
/// * `format` - 协商成功的独占格式
/// * `source` - 解码样本读取器（渲染线程独占）
/// * `volume` - 音量原子（f32 bits），与 PlaybackHandle 共享
/// * `stopped` - 停止标志，与 PlaybackHandle 共享
/// * `paused` - 初始是否暂停
/// * `on_failure` - 运行期设备错误回调（代次守卫由回调自身保证）
pub fn open_exclusive_stream(
    device_id: Option<&str>,
    format: ExclusiveFormat,
    source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    paused: bool,
    on_failure: Arc<dyn Fn() + Send + Sync + 'static>,
) -> Result<ExclusiveStream> {
    let device_id_owned = device_id.map(String::from);
    let endpoint = resolve_endpoint(device_id_owned.as_deref())?;

    unsafe {
        let mut client: IAudioClient = endpoint
            .Activate(CLSCTX_ALL, None)
            .context("激活音频客户端失败")?;

        // 独占 + 事件驱动：缓冲时长必须等于设备周期，未对齐时按实际帧数重试
        let mut default_period = 0i64;
        client.GetDevicePeriod(Some(&mut default_period), None)?;
        let wave = build_wave_format(&format);
        let wave_ptr = &wave as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX;
        let mut init = client.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            default_period,
            default_period,
            wave_ptr,
            None,
        );
        if let Err(error) = &init {
            if error.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                let aligned_frames = client.GetBufferSize()?;
                let aligned_duration = (i64::from(aligned_frames) * 10_000_000
                    + i64::from(format.sample_rate) / 2)
                    / i64::from(format.sample_rate);
                drop(client);
                client = endpoint
                    .Activate(CLSCTX_ALL, None)
                    .context("重新激活音频客户端失败")?;
                init = client.Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    aligned_duration,
                    aligned_duration,
                    wave_ptr,
                    None,
                );
            }
        }
        init.context("初始化独占模式音频客户端失败")?;

        let period_event = CreateEventW(None, false, false, None).context("创建周期事件失败")?;
        let shutdown_event = match CreateEventW(None, true, false, None) {
            Ok(event) => event,
            Err(error) => {
                let _ = CloseHandle(period_event);
                return Err(error).context("创建关闭事件失败");
            }
        };
        let period_handle = EventHandle(period_event);
        let shutdown_handle = EventHandle(shutdown_event);
        let handles = EventHandles(period_handle, shutdown_handle);

        let stream = (|| -> Result<ExclusiveStream> {
            client
                .SetEventHandle(period_handle.0)
                .context("设置事件句柄失败")?;
            let render: IAudioRenderClient = client.GetService().context("获取渲染客户端失败")?;
            let buffer_frames = client.GetBufferSize()?;

            let paused_flag = Arc::new(AtomicBool::new(paused));
            let thread_client = ComSend(client.clone());
            let thread_render = ComSend(render);
            let thread_format = format;
            let thread_paused = Arc::clone(&paused_flag);
            let (startup_tx, startup_rx) = sync_channel(1);
            let render_thread = std::thread::Builder::new()
                .name("wasapi-exclusive".into())
                .spawn(move || {
                    render_loop(
                        thread_client,
                        thread_render,
                        period_handle,
                        shutdown_handle,
                        buffer_frames,
                        thread_format,
                        source,
                        volume,
                        stopped,
                        thread_paused,
                        on_failure,
                        startup_tx,
                    );
                })
                .context("启动独占渲染线程失败")?;

            // 等待渲染线程完成预填充和 Start，保留开流错误的同步回退语义。
            if let Err(error) = startup_rx
                .recv()
                .context("独占渲染线程启动时退出")
                .and_then(|result| result)
            {
                shutdown_handle.set();
                let _ = render_thread.join();
                let _ = client.Stop();
                return Err(error);
            }

            info!(
                rate = format.sample_rate,
                channels = format.channels,
                bits = format.valid_bits,
                frames = buffer_frames,
                "独占模式输出流已创建"
            );
            Ok(ExclusiveStream {
                client: Some(client),
                period_event: period_handle,
                shutdown_event: shutdown_handle,
                render_thread: Some(render_thread),
                paused: paused_flag,
            })
        })();

        match stream {
            Ok(stream) => {
                // 句柄所有权已移交 ExclusiveStream，守卫只负责错误路径清理
                std::mem::forget(handles);
                Ok(stream)
            }
            Err(error) => Err(error),
        }
    }
}

/// 按当前音量/静音状态填满整个缓冲（启动前置填充）
fn prefill_buffer(
    render: &IAudioRenderClient,
    buffer_frames: u32,
    source: &mut DecoderSource,
    volume: &Arc<AtomicU32>,
    stopped: &Arc<AtomicBool>,
    paused: &Arc<AtomicBool>,
    format: &ExclusiveFormat,
) -> Result<()> {
    unsafe {
        let ptr = render.GetBuffer(buffer_frames).context("启动预填充失败")?;
        let gain = f32::from_bits(volume.load(Ordering::Relaxed));
        let silent = stopped.load(Ordering::Acquire) || paused.load(Ordering::Acquire);
        let block_align = usize::from(format.channels * format.container_bits / 8);
        let byte_buffer = std::slice::from_raw_parts_mut(ptr, buffer_frames as usize * block_align);
        fill_buffer(byte_buffer, source, gain, silent, format);
        render
            .ReleaseBuffer(buffer_frames, 0)
            .context("启动预填充提交失败")
    }
}

/// 渲染主循环：每个设备周期填充一次缓冲，退出后停止客户端
#[allow(clippy::too_many_arguments)]
fn render_loop(
    client: ComSend<IAudioClient>,
    render: ComSend<IAudioRenderClient>,
    period_event: EventHandle,
    shutdown_event: EventHandle,
    buffer_frames: u32,
    format: ExclusiveFormat,
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    on_failure: Arc<dyn Fn() + Send + Sync + 'static>,
    startup_tx: SyncSender<Result<()>>,
) {
    if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .context("初始化独占渲染线程 COM 失败")
    {
        let _ = startup_tx.send(Err(error));
        return;
    }
    let _apartment = RenderApartment;
    let client = client.0;
    let render = render.0;
    let _priority = crate::priority::RenderThreadPriority::new();
    // 输出必须在供数线程取得调度优先级后启动，避免创建线程期间耗尽首个缓冲。
    let startup = prefill_buffer(
        &render,
        buffer_frames,
        &mut source,
        &volume,
        &stopped,
        &paused,
        &format,
    )
    .and_then(|()| unsafe { client.Start().context("启动独占模式输出失败") });
    let started = startup.is_ok();
    if startup_tx.send(startup).is_err() || !started {
        unsafe {
            let _ = client.Stop();
        }
        return;
    }
    let wait_handles = [period_event.0, shutdown_event.0];
    let block_align = usize::from(format.channels * format.container_bits / 8);
    let period = Duration::from_secs_f64(f64::from(buffer_frames) / f64::from(format.sample_rate));
    let mut last_wake = Instant::now();
    let mut late_wakes = 0u64;
    let mut longest_gap = Duration::ZERO;

    loop {
        let wait = unsafe { WaitForMultipleObjects(&wait_handles, false, INFINITE) };
        if wait == WAIT_EVENT(WAIT_OBJECT_0.0 + SHUTDOWN_EVENT_INDEX) {
            break;
        }
        if wait.0 > WAIT_OBJECT_0.0 + 1 {
            warn!(code = wait.0, "独占模式等待周期事件失败");
            on_failure();
            break;
        }

        let now = Instant::now();
        let gap = now.duration_since(last_wake);
        last_wake = now;
        if !paused.load(Ordering::Acquire) && !stopped.load(Ordering::Acquire) {
            longest_gap = longest_gap.max(gap);
            if gap > period * 2 {
                late_wakes += 1;
            }
        }

        // 独占事件驱动模式
        let buffer_ptr = match unsafe { render.GetBuffer(buffer_frames) } {
            Ok(ptr) => ptr,
            Err(error) => {
                warn!(error = %error, "独占模式获取渲染缓冲失败");
                on_failure();
                break;
            }
        };

        let gain = f32::from_bits(volume.load(Ordering::Relaxed));
        let silent = stopped.load(Ordering::Acquire) || paused.load(Ordering::Acquire);
        let byte_buffer = unsafe {
            std::slice::from_raw_parts_mut(buffer_ptr, buffer_frames as usize * block_align)
        };
        fill_buffer(byte_buffer, &mut source, gain, silent, &format);

        if let Err(error) = unsafe { render.ReleaseBuffer(buffer_frames, 0) } {
            warn!(error = %error, "独占模式提交渲染缓冲失败");
            on_failure();
            break;
        }
    }

    unsafe {
        let _ = client.Stop();
    }
    if late_wakes > 0 {
        warn!(
            late_wakes,
            longest_gap_ms = longest_gap.as_secs_f64() * 1000.0,
            period_ms = period.as_secs_f64() * 1000.0,
            "独占输出唤醒间隔超过两个设备周期"
        );
    }
    debug!(late_wakes, "独占模式渲染线程退出");
}

/// 读取实际开流失败的 HRESULT，保留稳定的回退提示分类。
pub fn fallback_reason(error: &anyhow::Error) -> &'static str {
    match error
        .downcast_ref::<windows::core::Error>()
        .map(|error| error.code())
    {
        Some(AUDCLNT_E_DEVICE_IN_USE) => "deviceBusy",
        Some(AUDCLNT_E_UNSUPPORTED_FORMAT) => "formatUnsupported",
        _ => "unavailable",
    }
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
