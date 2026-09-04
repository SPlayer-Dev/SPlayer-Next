//! Windows WASAPI 独占模式输出（绕过系统混音器，bit-perfect 回放）。
//!
//! 与共享模式（cpal）互斥：协商成功的格式即解码重采样目标，
//! 渲染线程以事件驱动方式从 `DecoderSource` 拉取 f32 样本，
//! 按协商位深转成整型交给声卡。设备被其他程序独占或格式不支持时，
//! 协商阶段返回带稳定分类的错误，由调用方回退共享模式。

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{Context, Result};
use tracing::{debug, info, warn};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_EVENT};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_E_DEVICE_IN_USE,
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{
    CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects,
};

use crate::source::DecoderSource;

/// KSDATAFORMAT_SUBTYPE_PCM
const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

/// WAVE_FORMAT_EXTENSIBLE
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

/// SPEAKER_MONO
const SPEAKER_MONO: u32 = 0x4;
/// SPEAKER_STEREO
const SPEAKER_STEREO: u32 = 0x3;
/// SPEAKER_5POINT1（含低音炮）
const SPEAKER_5POINT1: u32 = 0x3F;
/// SPEAKER_7POINT1
const SPEAKER_7POINT1: u32 = 0x63;

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

/// 按 cpal 设备 ID 字符串解析 WASAPI 端点 ID。
/// cpal 0.18 存储的就是 `IMMDevice::GetId` 字符串（形如 `{0.0.0.00000000}.{guid}`），
/// 序列化时可能带后端前缀，取首个 `{` 起的子串即可剥离。
fn endpoint_id_from_device_id(device_id: &str) -> &str {
    match device_id.find('{') {
        Some(index) => &device_id[index..],
        None => device_id,
    }
}

/// 按端点 ID 或系统默认解析渲染端点
fn resolve_endpoint(device_id: Option<&str>) -> Result<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).context("创建设备枚举器失败")?;
        match device_id {
            Some(id) => {
                let wide: Vec<u16> = endpoint_id_from_device_id(id)
                    .encode_utf16()
                    .chain([0])
                    .collect();
                enumerator
                    .GetDevice(PCWSTR(wide.as_ptr()))
                    .with_context(|| format!("解析输出端点 '{id}' 失败"))
            }
            None => enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .context("解析默认输出端点失败"),
        }
    }
}

/// 声道掩码：仅覆盖常见布局，其余布局独占模式协商本就难以通过
fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => SPEAKER_MONO,
        2 => SPEAKER_STEREO,
        6 => SPEAKER_5POINT1,
        8 => SPEAKER_7POINT1,
        _ => 0,
    }
}

/// 构造 PCM 整型 WAVEFORMATEXTENSIBLE
fn build_wave_format(format: &ExclusiveFormat) -> WAVEFORMATEXTENSIBLE {
    let block_align = format.channels * format.container_bits / 8;
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: format.channels,
            nSamplesPerSec: format.sample_rate,
            wBitsPerSample: format.container_bits,
            nBlockAlign: block_align,
            nAvgBytesPerSec: format.sample_rate * u32::from(block_align),
            cbSize: std::mem::size_of::<WAVEFORMATEXTENSIBLE_0>() as u16,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: format.valid_bits,
        },
        dwChannelMask: channel_mask(format.channels),
        SubFormat: KSDATAFORMAT_SUBTYPE_PCM,
    }
}

/// 位深候选：优先音源位深（bit-perfect），16bit 作通用兜底
fn valid_bits_candidates(source_bits: u32) -> Vec<u16> {
    match source_bits {
        0..=16 => vec![16, 24],
        24 => vec![24, 16],
        _ => vec![32, 24, 16],
    }
}

/// 采样率候选：音源原始值优先，回退设备常见的离散值
fn sample_rate_candidates(source_rate: u32) -> Vec<u32> {
    let mut rates = vec![source_rate, 48_000, 44_100, 96_000, 192_000];
    rates.dedup();
    rates
}

/// 独占模式格式协商：逐个尝试候选组合，返回首个被设备接受的格式。
/// 探测用的 IAudioClient 随函数退出释放，不占用设备独占锁
fn negotiate_format(
    device: &IMMDevice,
    source_rate: u32,
    source_bits: u32,
    fallback_channels: u16,
) -> Result<ExclusiveFormat, ExclusiveOpenError> {
    unsafe {
        let probe: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .context("激活探测音频客户端失败")?;

        let mut channels_candidates = vec![fallback_channels, 2];
        channels_candidates.dedup();

        for &channels in &channels_candidates {
            for &valid_bits in &valid_bits_candidates(source_bits) {
                for &rate in &sample_rate_candidates(source_rate) {
                    let format = ExclusiveFormat {
                        sample_rate: rate,
                        channels,
                        container_bits: if valid_bits == 16 { 16 } else { 32 },
                        valid_bits,
                    };
                    let wave = build_wave_format(&format);
                    // windows 0.62 中 IsFormatSupported 返回原始 HRESULT
                    let hr = probe.IsFormatSupported(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        &wave as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX,
                        None,
                    );
                    if hr.is_ok() {
                        info!(
                            rate = format.sample_rate,
                            channels = format.channels,
                            bits = format.valid_bits,
                            "独占模式格式协商成功"
                        );
                        return Ok(format);
                    }
                    if hr == AUDCLNT_E_DEVICE_IN_USE {
                        return Err(ExclusiveOpenError::DeviceInUse);
                    }
                }
            }
        }
        Err(ExclusiveOpenError::FormatUnsupported)
    }
}

/// 独占模式格式协商入口：解析端点并逐个尝试候选格式
pub fn negotiate_exclusive_format(
    device_id: Option<&str>,
    source_rate: u32,
    source_bits: u32,
    fallback_channels: u16,
) -> Result<ExclusiveFormat, ExclusiveOpenError> {
    let endpoint = resolve_endpoint(device_id).map_err(ExclusiveOpenError::Other)?;
    negotiate_format(&endpoint, source_rate, source_bits, fallback_channels)
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

/// 渲染线程等待用句柄对守卫：中途出错时保证关闭
struct EventHandles(EventHandle, EventHandle);

impl Drop for EventHandles {
    fn drop(&mut self) {
        self.0.close();
        self.1.close();
    }
}

/// f32 → 整型样本转换（应用音量增益后写入）
fn convert_sample(sample: f32, gain: f32, valid_bits: u16) -> i32 {
    let clamped = (sample * gain).clamp(-1.0, 1.0);
    match valid_bits {
        16 => (clamped * 32_767.0) as i32,
        24 => ((clamped * 8_388_607.0) as i32) << 8,
        _ => (clamped * 2_147_483_647.0) as i32,
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
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    paused: bool,
    on_failure: Arc<dyn Fn() + Send + Sync + 'static>,
) -> Result<ExclusiveStream> {
    let device_id_owned = device_id.map(String::from);
    let endpoint = resolve_endpoint(device_id_owned.as_deref())?;

    unsafe {
        let client: IAudioClient =
            endpoint.Activate(CLSCTX_ALL, None).context("激活音频客户端失败")?;

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
                let aligned_duration =
                    i64::from(aligned_frames) * 10_000_000 / i64::from(format.sample_rate);
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
        let shutdown_event = CreateEventW(None, true, false, None).context("创建关闭事件失败")?;
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
            // 事件驱动模式下必须先填满缓冲再启动
            prefill_buffer(
                &render,
                buffer_frames,
                &mut source,
                &volume,
                &stopped,
                &paused_flag,
                &format,
            )?;
            client.Start().context("启动独占模式输出失败")?;

            let thread_client = ComSend(client.clone());
            let thread_render = ComSend(render);
            let thread_format = format;
            let thread_paused = Arc::clone(&paused_flag);
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
                    );
                })
                .context("启动独占渲染线程失败")?;

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
        let byte_buffer =
            std::slice::from_raw_parts_mut(ptr, buffer_frames as usize * block_align);
        fill_buffer(byte_buffer, source, gain, silent, format);
        render.ReleaseBuffer(buffer_frames, 0).context("启动预填充提交失败")
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
) {
    let client = client.0;
    let render = render.0;
    let wait_handles = [period_event.0, shutdown_event.0];
    let block_align = usize::from(format.channels * format.container_bits / 8);

    loop {
        let wait = unsafe { WaitForMultipleObjects(&wait_handles, false, INFINITE) };
        if wait == WAIT_EVENT(WAIT_OBJECT_0.0 + SHUTDOWN_EVENT_INDEX) {
            break;
        }

        let padding = match unsafe { client.GetCurrentPadding() } {
            Ok(padding) => padding,
            Err(error) => {
                warn!(error = %error, "独占模式读取缓冲水位失败");
                on_failure();
                break;
            }
        };
        let available = buffer_frames.saturating_sub(padding);
        if available == 0 {
            continue;
        }

        let buffer_ptr = match unsafe { render.GetBuffer(available) } {
            Ok(ptr) => ptr,
            Err(error) => {
                warn!(error = %error, "独占模式获取渲染缓冲失败");
                on_failure();
                break;
            }
        };

        let gain = f32::from_bits(volume.load(Ordering::Relaxed));
        let silent = stopped.load(Ordering::Acquire) || paused.load(Ordering::Acquire);
        let byte_buffer =
            unsafe { std::slice::from_raw_parts_mut(buffer_ptr, available as usize * block_align) };
        fill_buffer(byte_buffer, &mut source, gain, silent, &format);

        if let Err(error) = unsafe { render.ReleaseBuffer(available, 0) } {
            warn!(error = %error, "独占模式提交渲染缓冲失败");
            on_failure();
            break;
        }
    }

    unsafe {
        let _ = client.Stop();
    }
    debug!("独占模式渲染线程退出");
}

/// 将渲染缓冲按有效位深填充（交错样本，静音时填零）
fn fill_buffer(
    buffer: &mut [u8],
    source: &mut DecoderSource,
    gain: f32,
    silent: bool,
    format: &ExclusiveFormat,
) {
    let bytes_per_sample = usize::from(format.container_bits / 8);
    let mut raw = [0u8; 4];
    for chunk in buffer.chunks_exact_mut(bytes_per_sample) {
        let value = if silent {
            0
        } else {
            convert_sample(source.next().unwrap_or(0.0), gain, format.valid_bits)
        };
        raw[..bytes_per_sample].copy_from_slice(&value.to_le_bytes()[..bytes_per_sample]);
        chunk.copy_from_slice(&raw[..bytes_per_sample]);
    }
}
