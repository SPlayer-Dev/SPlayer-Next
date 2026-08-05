//! 直接使用 CPAL 的音频输出层。
//!
//! CPAL stream 由专属 owner 线程创建、持有和释放。解码线程通过固定容量的
//! `rtrb` SPSC ring 投递 PCM；CPAL 回调不访问锁、分配内存、记录日志或调用 FFI。

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, StreamConfig};
use rtrb::{Consumer, Producer, RingBuffer};
use tracing::{debug, info, warn};

use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::shared::Shared;
use crate::source::{DecoderSource, StereoFrame};
use crate::tempo::StretchProcessor;

const RING_BUFFER_MS: u32 = 250;
const STREAM_EVENT_NONE: u8 = 0;
const STREAM_EVENT_ROUTE_CHANGED: u8 = 1;
const STREAM_EVENT_REBUILD_REQUIRED: u8 = 2;
const MEDIA_FRAME_SCALE: f64 = (1_u64 << 32) as f64;
const DEVICE_BUSY_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(80), Duration::from_millis(200)];

static CALLBACK_ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static IN_AUDIO_CALLBACK: Cell<bool> = const { Cell::new(false) };
}

struct CallbackAwareAllocator;

// SAFETY: 所有分配、释放与重分配均原样委托给 System；额外逻辑只读取当前线程的 Cell 并更新原子计数。
unsafe impl GlobalAlloc for CallbackAwareAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        IN_AUDIO_CALLBACK.with(|active| {
            if active.get() {
                CALLBACK_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            }
        });
        // SAFETY: layout 由调用方按 GlobalAlloc 契约提供，完整转发给 System。
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: ptr/layout 来自同一 System allocator 的分配，完整转发释放。
        unsafe { System.dealloc(ptr, layout) };
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        IN_AUDIO_CALLBACK.with(|active| {
            if active.get() {
                CALLBACK_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            }
        });
        // SAFETY: ptr/layout 来自 System，new_size 保持 GlobalAlloc 的 realloc 契约。
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        IN_AUDIO_CALLBACK.with(|active| {
            if active.get() {
                CALLBACK_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            }
        });
        // SAFETY: layout 由调用方按 GlobalAlloc 契约提供，完整转发给 System。
        unsafe { System.alloc_zeroed(layout) }
    }
}

#[global_allocator]
static GLOBAL_ALLOCATOR: CallbackAwareAllocator = CallbackAwareAllocator;

#[derive(Clone, Copy)]
struct OutputSample {
    value: f32,
    media_frame_q32: u64,
}

/// 输出回调可读取的原子状态。该结构不包含任何会阻塞的同步原语。
pub struct OutputControl {
    volume_bits: AtomicU32,
    paused: AtomicBool,
    source_finished: AtomicBool,
    all_consumed: AtomicBool,
    submitted_samples: AtomicU64,
    underrun_samples: AtomicU64,
    played_media_frame_q32: AtomicU64,
    audible_media_frame_q32: AtomicU64,
    clock_quality: AtomicU8,
    xrun_count: AtomicU64,
    realtime_denied_count: AtomicU64,
    callback_allocation_count: AtomicU64,
    callback_max_duration_us: AtomicU64,
    ring_capacity_samples: AtomicU64,
    ring_fill_samples: AtomicU64,
    stream_event: AtomicU8,
}

impl OutputControl {
    fn new() -> Self {
        Self {
            volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            paused: AtomicBool::new(true),
            source_finished: AtomicBool::new(false),
            all_consumed: AtomicBool::new(false),
            submitted_samples: AtomicU64::new(0),
            underrun_samples: AtomicU64::new(0),
            played_media_frame_q32: AtomicU64::new(0),
            audible_media_frame_q32: AtomicU64::new(0),
            clock_quality: AtomicU8::new(0),
            xrun_count: AtomicU64::new(0),
            realtime_denied_count: AtomicU64::new(0),
            callback_allocation_count: AtomicU64::new(0),
            callback_max_duration_us: AtomicU64::new(0),
            ring_capacity_samples: AtomicU64::new(0),
            ring_fill_samples: AtomicU64::new(0),
            stream_event: AtomicU8::new(STREAM_EVENT_NONE),
        }
    }

    pub fn set_volume(&self, volume: f32) {
        self.volume_bits.store(volume.to_bits(), Ordering::Relaxed);
    }

    pub fn play(&self) {
        self.paused.store(false, Ordering::Release);
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
    }

    fn reset_clock(&self) {
        self.source_finished.store(false, Ordering::Release);
        self.all_consumed.store(false, Ordering::Release);
        self.submitted_samples.store(0, Ordering::Release);
        self.underrun_samples.store(0, Ordering::Release);
        self.played_media_frame_q32.store(0, Ordering::Release);
        self.audible_media_frame_q32.store(0, Ordering::Release);
        self.clock_quality.store(0, Ordering::Release);
        self.callback_allocation_count.store(0, Ordering::Release);
        self.callback_max_duration_us.store(0, Ordering::Release);
        self.stream_event
            .store(STREAM_EVENT_NONE, Ordering::Release);
    }

    pub fn submitted_samples(&self) -> u64 {
        self.submitted_samples.load(Ordering::Acquire)
    }

    pub fn all_consumed(&self) -> bool {
        self.all_consumed.load(Ordering::Acquire)
    }

    pub(crate) fn take_stream_event(&self) -> Option<OutputStreamEvent> {
        match self.stream_event.swap(STREAM_EVENT_NONE, Ordering::AcqRel) {
            STREAM_EVENT_ROUTE_CHANGED => Some(OutputStreamEvent::RouteChanged),
            STREAM_EVENT_REBUILD_REQUIRED => Some(OutputStreamEvent::RebuildRequired),
            _ => None,
        }
    }

    pub fn media_position(&self, sample_rate: u32) -> f64 {
        self.audible_media_frame_q32.load(Ordering::Acquire) as f64
            / MEDIA_FRAME_SCALE
            / f64::from(sample_rate)
    }

    pub fn diagnostics(&self) -> OutputDiagnostics {
        OutputDiagnostics {
            submitted_samples: self.submitted_samples.load(Ordering::Acquire),
            underrun_samples: self.underrun_samples.load(Ordering::Acquire),
            xrun_count: self.xrun_count.load(Ordering::Acquire),
            realtime_denied_count: self.realtime_denied_count.load(Ordering::Acquire),
            callback_allocation_count: self.callback_allocation_count.load(Ordering::Acquire),
            callback_max_duration_us: self.callback_max_duration_us.load(Ordering::Acquire),
            ring_capacity_samples: self.ring_capacity_samples.load(Ordering::Acquire),
            ring_fill_samples: self.ring_fill_samples.load(Ordering::Acquire),
            clock_quality: if self.clock_quality.load(Ordering::Acquire) == 1 {
                ClockQuality::Hardware
            } else {
                ClockQuality::Estimated
            },
        }
    }
}

#[derive(Clone, Copy)]
pub enum ClockQuality {
    Hardware,
    Estimated,
}

#[derive(Clone, Copy)]
pub struct OutputDiagnostics {
    pub submitted_samples: u64,
    pub underrun_samples: u64,
    pub xrun_count: u64,
    pub realtime_denied_count: u64,
    pub callback_allocation_count: u64,
    pub callback_max_duration_us: u64,
    pub ring_capacity_samples: u64,
    pub ring_fill_samples: u64,
    pub clock_quality: ClockQuality,
}

struct CallbackMetrics<'a> {
    control: &'a OutputControl,
    started_at: Instant,
    allocations_at_start: u64,
}

impl<'a> CallbackMetrics<'a> {
    fn enter(control: &'a OutputControl) -> Self {
        let allocations_at_start = CALLBACK_ALLOCATIONS.load(Ordering::Relaxed);
        IN_AUDIO_CALLBACK.with(|active| active.set(true));
        Self {
            control,
            started_at: Instant::now(),
            allocations_at_start,
        }
    }
}

impl Drop for CallbackMetrics<'_> {
    fn drop(&mut self) {
        IN_AUDIO_CALLBACK.with(|active| active.set(false));
        let allocations = CALLBACK_ALLOCATIONS
            .load(Ordering::Relaxed)
            .saturating_sub(self.allocations_at_start);
        if allocations > 0 {
            self.control
                .callback_allocation_count
                .fetch_add(allocations, Ordering::Relaxed);
        }
        let elapsed_us = self
            .started_at
            .elapsed()
            .as_micros()
            .min(u128::from(u64::MAX)) as u64;
        self.control
            .callback_max_duration_us
            .fetch_max(elapsed_us, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy)]
pub(crate) enum OutputStreamEvent {
    RouteChanged,
    RebuildRequired,
}

/// 直接 CPAL 输出。CPAL stream 永远只存在于 owner 线程。
pub struct AudioOutput {
    control: Arc<OutputControl>,
    sample_rate: u32,
    channels: u16,
    producer: Option<Producer<OutputSample>>,
    feeder_stop: Option<Arc<AtomicBool>>,
    feeder: Option<JoinHandle<Producer<OutputSample>>>,
    shutdown: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl AudioOutput {
    /// 在 owner 线程创建默认共享输出流。
    ///
    /// `device_id` 为空时使用系统默认设备；非空时使用 CPAL 的稳定 DeviceId，
    /// 不再通过设备名称猜测或枚举采样率。
    pub fn new(device_id: Option<&str>) -> Result<Self> {
        for (attempt, delay) in DEVICE_BUSY_RETRY_DELAYS.iter().enumerate() {
            match Self::try_new(device_id) {
                Ok(output) => return Ok(output),
                Err(error) if is_device_busy(&error) => {
                    warn!(
                        attempt = attempt + 1,
                        delay_ms = delay.as_millis(),
                        "输出设备忙，有限重试"
                    );
                    thread::sleep(*delay);
                }
                Err(error) => return Err(error),
            }
        }
        Self::try_new(device_id)
    }

    fn try_new(device_id: Option<&str>) -> Result<Self> {
        let device_id = device_id.map(String::from);
        let control = Arc::new(OutputControl::new());
        let control_for_thread = Arc::clone(&control);
        let (result_tx, result_rx) = mpsc::sync_channel::<Result<OutputReady>>(1);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let thread = thread::Builder::new()
            .name("audio-output-owner".to_string())
            .spawn(move || {
                let result = build_output_stream(device_id.as_deref(), control_for_thread);
                match result {
                    Ok(build) => {
                        let OutputBuild {
                            stream,
                            producer,
                            sample_rate,
                            channels,
                        } = build;
                        let send_result = result_tx.send(Ok(OutputReady {
                            producer,
                            sample_rate,
                            channels,
                        }));
                        if send_result.is_err() {
                            return;
                        }
                        let _ = shutdown_rx.recv();
                        drop(stream);
                    }
                    Err(error) => {
                        let _ = result_tx.send(Err(error));
                    }
                }
                debug!("audio-output-owner 已释放 CPAL stream");
            })
            .context("启动 audio-output-owner 线程失败")?;

        let build = match result_rx.recv() {
            Ok(Ok(build)) => build,
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(error) => {
                let _ = thread.join();
                return Err(error).context("audio-output-owner 握手失败");
            }
        };

        Ok(Self {
            control,
            sample_rate: build.sample_rate,
            channels: build.channels,
            producer: Some(build.producer),
            feeder_stop: None,
            feeder: None,
            shutdown: Some(shutdown_tx),
            thread: Some(thread),
        })
    }

    pub fn control(&self) -> Arc<OutputControl> {
        Arc::clone(&self.control)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// 启动解码输出泵。该线程可执行锁、DSP 和短暂等待，绝不运行在 CPAL 回调。
    pub fn start_feeder(
        &mut self,
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        equalizer: Arc<parking_lot::Mutex<Equalizer>>,
        tempo: Arc<parking_lot::Mutex<StretchProcessor>>,
    ) -> Result<()> {
        self.stop_feeder();
        let producer = self
            .producer
            .take()
            .context("音频输出 ring producer 不可用")?;
        self.control.reset_clock();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop);
        let channels = self.channels;
        let control = Arc::clone(&self.control);
        let handle = thread::Builder::new()
            .name("audio-dsp-output".to_string())
            .spawn(move || {
                let mut source = DecoderSource::new(Arc::clone(&shared), fft, equalizer, tempo);
                let mut producer = producer;
                let mut stopped = false;
                loop {
                    if stop_for_thread.load(Ordering::Acquire) || shared.is_stopping() {
                        stopped = true;
                        break;
                    }
                    let Some(frame) = source.next_frame() else {
                        break;
                    };
                    for channel in 0..channels {
                        let mut pending = output_sample(frame, channel, channels);
                        loop {
                            match producer.push(pending) {
                                Ok(()) => break,
                                Err(error) => {
                                    if stop_for_thread.load(Ordering::Acquire)
                                        || shared.is_stopping()
                                    {
                                        return producer;
                                    }
                                    let rtrb::PushError::Full(value) = error;
                                    pending = value;
                                    thread::sleep(Duration::from_millis(1));
                                }
                            }
                        }
                    }
                }
                if !stopped {
                    control.source_finished.store(true, Ordering::Release);
                }
                producer
            })
            .context("启动音频 DSP 输出线程失败")?;
        self.feeder_stop = Some(stop);
        self.feeder = Some(handle);
        Ok(())
    }

    pub(crate) fn stop_feeder(&mut self) {
        if let Some(stop) = self.feeder_stop.take() {
            stop.store(true, Ordering::Release);
        }
        if let Some(handle) = self.feeder.take() {
            match handle.join() {
                Ok(producer) => self.producer = Some(producer),
                Err(_) => warn!("音频 DSP 输出线程异常退出"),
            }
        }
    }

    pub fn reset_clock(&self) {
        self.control.reset_clock();
    }

    pub fn play(&self) {
        self.control.play();
    }

    pub fn pause(&self) {
        self.control.pause();
    }

    pub fn set_volume(&self, volume: f32) {
        self.control.set_volume(volume);
    }

    pub fn is_finished(&self) -> bool {
        self.control.all_consumed()
    }

    pub fn position(&self) -> f64 {
        self.control.media_position(self.sample_rate)
    }

    pub fn diagnostics(&self) -> OutputDiagnostics {
        self.control.diagnostics()
    }
}

fn is_device_busy(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<cpal::Error>()
            .is_some_and(|error| error.kind() == cpal::ErrorKind::DeviceBusy)
    })
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        self.stop_feeder();
        drop(self.shutdown.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct OutputBuild {
    stream: cpal::Stream,
    producer: Producer<OutputSample>,
    sample_rate: u32,
    channels: u16,
}

struct OutputReady {
    producer: Producer<OutputSample>,
    sample_rate: u32,
    channels: u16,
}

fn build_output_stream(
    device_id: Option<&str>,
    control: Arc<OutputControl>,
) -> Result<OutputBuild> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(id) => {
            let parsed = id.parse::<cpal::DeviceId>().context("输出设备 ID 无效")?;
            host.device_by_id(&parsed).ok_or_else(|| {
                cpal::Error::with_message(
                    cpal::ErrorKind::DeviceNotAvailable,
                    "保存的输出设备不可用",
                )
            })?
        }
        None => host.default_output_device().ok_or_else(|| {
            cpal::Error::with_message(cpal::ErrorKind::DeviceNotAvailable, "没有系统默认输出设备")
        })?,
    };
    let supported = device
        .default_output_config()
        .context("读取默认输出配置失败")?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels();
    let capacity = ring_capacity(sample_rate, channels)?;
    control
        .ring_capacity_samples
        .store(capacity as u64, Ordering::Release);
    let (producer, consumer) = RingBuffer::new(capacity);
    let config: StreamConfig = supported.config();
    let error_control = Arc::clone(&control);
    let stream = match supported.sample_format() {
        SampleFormat::I8 => build_stream::<i8>(&device, config, consumer, control, error_control)?,
        SampleFormat::I16 => {
            build_stream::<i16>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::I24 => {
            build_stream::<cpal::I24>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::I32 => {
            build_stream::<i32>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::I64 => {
            build_stream::<i64>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::U8 => build_stream::<u8>(&device, config, consumer, control, error_control)?,
        SampleFormat::U16 => {
            build_stream::<u16>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::U24 => {
            build_stream::<cpal::U24>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::U32 => {
            build_stream::<u32>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::U64 => {
            build_stream::<u64>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::F32 => {
            build_stream::<f32>(&device, config, consumer, control, error_control)?
        }
        SampleFormat::F64 => {
            build_stream::<f64>(&device, config, consumer, control, error_control)?
        }
        format => anyhow::bail!("不支持的输出采样格式: {format}"),
    };
    stream.play().context("启动音频输出 stream 失败")?;
    info!(
        host = %host.id(),
        device = %device,
        sample_rate,
        channels,
        "已创建 CPAL 默认输出 stream"
    );
    Ok(OutputBuild {
        stream,
        producer,
        sample_rate,
        channels,
    })
}

fn build_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut consumer: Consumer<OutputSample>,
    control: Arc<OutputControl>,
    error_control: Arc<OutputControl>,
) -> Result<cpal::Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels);
    let output_sample_rate = config.sample_rate;
    let stream = device
        .build_output_stream(
            config,
            move |output: &mut [T], info| {
                let _metrics = CallbackMetrics::enter(&control);
                let paused = control.paused.load(Ordering::Acquire);
                let volume = f32::from_bits(control.volume_bits.load(Ordering::Relaxed));
                if paused {
                    for sample in output {
                        *sample = T::from_sample(0.0);
                    }
                    let fill = consumer.slots();
                    control
                        .ring_fill_samples
                        .store((fill - fill % channels) as u64, Ordering::Relaxed);
                    return;
                }
                let mut submitted = 0_u64;
                let mut underrun = 0_u64;
                let mut media_frame_q32 = 0_u64;
                for frame in output.chunks_mut(channels) {
                    // 生产者逐声道提交；只有完整端点帧可用时才消费，避免跨回调发生声道错位。
                    let Ok(input_frame) = consumer.read_chunk(channels) else {
                        for sample in frame {
                            *sample = T::from_sample(0.0);
                            submitted += 1;
                            underrun += 1;
                        }
                        continue;
                    };
                    for (sample, value) in frame.iter_mut().zip(input_frame) {
                        media_frame_q32 = media_frame_q32.saturating_add(value.media_frame_q32);
                        let value = value.value * volume;
                        *sample = T::from_sample(value);
                        submitted += 1;
                    }
                }
                control
                    .submitted_samples
                    .fetch_add(submitted, Ordering::Release);
                if underrun > 0 {
                    control
                        .underrun_samples
                        .fetch_add(underrun, Ordering::Relaxed);
                }
                if media_frame_q32 > 0 {
                    let previous_media_q32 = control
                        .played_media_frame_q32
                        .fetch_add(media_frame_q32, Ordering::AcqRel);
                    let submitted_media_q32 = previous_media_q32.saturating_add(media_frame_q32);
                    let timestamp = info.timestamp();
                    if let Some(latency) = timestamp
                        .playback
                        .checked_duration_since(timestamp.callback)
                    {
                        let output_frames = output.len() / channels;
                        let media_per_output_frame = if output_frames == 0 {
                            0.0
                        } else {
                            media_frame_q32 as f64 / output_frames as f64
                        };
                        let queued_output_frames =
                            latency.as_secs_f64() * f64::from(output_sample_rate);
                        let queued_media_q32 = (queued_output_frames * media_per_output_frame)
                            .clamp(0.0, u64::MAX as f64)
                            as u64;
                        control.audible_media_frame_q32.store(
                            submitted_media_q32.saturating_sub(queued_media_q32),
                            Ordering::Release,
                        );
                        control.clock_quality.store(1, Ordering::Release);
                    } else {
                        control
                            .audible_media_frame_q32
                            .store(submitted_media_q32, Ordering::Release);
                        control.clock_quality.store(0, Ordering::Release);
                    }
                }
                if control.source_finished.load(Ordering::Acquire) && consumer.is_empty() {
                    control.all_consumed.store(true, Ordering::Release);
                }
                let fill = consumer.slots();
                control
                    .ring_fill_samples
                    .store((fill - fill % channels) as u64, Ordering::Relaxed);
            },
            move |error| {
                let event = match error.kind() {
                    cpal::ErrorKind::DeviceChanged => STREAM_EVENT_ROUTE_CHANGED,
                    cpal::ErrorKind::RealtimeDenied => {
                        error_control
                            .realtime_denied_count
                            .fetch_add(1, Ordering::Relaxed);
                        STREAM_EVENT_NONE
                    }
                    cpal::ErrorKind::Xrun => {
                        error_control.xrun_count.fetch_add(1, Ordering::Relaxed);
                        STREAM_EVENT_NONE
                    }
                    _ => STREAM_EVENT_REBUILD_REQUIRED,
                };
                if event != STREAM_EVENT_NONE {
                    // rebuild 的严重级别高于 route change，不能被随后到达的轻量事件覆盖。
                    error_control
                        .stream_event
                        .fetch_max(event, Ordering::Release);
                }
            },
            None,
        )
        .context("创建 CPAL 输出 stream 失败")?;
    Ok(stream)
}

fn output_sample(frame: StereoFrame, channel: u16, channels: u16) -> OutputSample {
    let value = match channels {
        1 => (frame.left + frame.right) * 0.5,
        _ if channel == 0 => frame.left,
        _ if channel == 1 => frame.right,
        _ => 0.0,
    };
    OutputSample {
        value,
        media_frame_q32: if channel == 0 {
            frame.media_frame_q32
        } else {
            0
        },
    }
}

fn ring_capacity(sample_rate: u32, channels: u16) -> Result<usize> {
    anyhow::ensure!(sample_rate > 0 && channels > 0, "音频格式无效");
    let samples = u64::from(sample_rate)
        .checked_mul(u64::from(channels))
        .and_then(|value| value.checked_mul(u64::from(RING_BUFFER_MS)))
        .and_then(|value| value.checked_div(1000))
        .context("音频 ring 容量计算溢出")?;
    let samples = usize::try_from(samples).context("音频 ring 容量超出平台限制")?;
    let frame = usize::from(channels);
    let capacity = samples
        .checked_add(frame - 1)
        .and_then(|value| value.checked_div(frame))
        .and_then(|frames| frames.checked_mul(frame))
        .context("音频 ring 容量无效")?;
    Ok(capacity.max(frame))
}

/// 返回 CPAL DeviceId、名称、host 和默认标记，供设置持久化和展示。
pub fn list_output_devices() -> Vec<(String, String, String, bool)> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|device| device.id().ok());
    host.output_devices()
        .map(|devices| {
            devices
                .filter_map(|device| {
                    let id = device.id().ok()?;
                    let name = device.to_string();
                    let is_default = default_id.as_ref() == Some(&id);
                    Some((id.to_string(), name, host.id().to_string(), is_default))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn default_device_name() -> Option<String> {
    cpal::default_host()
        .default_output_device()
        .map(|device| device.to_string())
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;

    use super::{CallbackMetrics, OutputControl, output_sample, ring_capacity};
    use crate::source::StereoFrame;

    #[test]
    fn ring_capacity_is_frame_aligned() {
        let capacity = ring_capacity(48_000, 2).unwrap();
        assert_eq!(capacity % 2, 0);
        assert!(capacity >= 48_000 / 4 * 2);
    }

    #[test]
    fn ring_capacity_rejects_zero_channels() {
        assert!(ring_capacity(48_000, 0).is_err());
    }

    #[test]
    fn maps_stereo_to_mono_without_double_counting_media_time() {
        let frame = StereoFrame {
            left: 0.5,
            right: -0.25,
            media_frame_q32: 1_u64 << 32,
        };
        let sample = output_sample(frame, 0, 1);
        assert!((sample.value - 0.125).abs() < f32::EPSILON);
        assert_eq!(sample.media_frame_q32, 1_u64 << 32);
    }

    #[test]
    fn maps_stereo_to_multichannel_front_pair() {
        let frame = StereoFrame {
            left: 0.5,
            right: -0.25,
            media_frame_q32: 1_u64 << 32,
        };
        let samples: Vec<_> = (0..6)
            .map(|channel| output_sample(frame, channel, 6))
            .collect();
        assert_eq!(samples[0].value, 0.5);
        assert_eq!(samples[1].value, -0.25);
        assert!(samples[2..].iter().all(|sample| sample.value == 0.0));
        assert_eq!(
            samples
                .iter()
                .map(|sample| sample.media_frame_q32)
                .sum::<u64>(),
            1_u64 << 32
        );
    }

    #[test]
    fn callback_allocator_probe_detects_heap_activity() {
        let control = OutputControl::new();
        {
            let _metrics = CallbackMetrics::enter(&control);
            black_box(Vec::<u8>::with_capacity(16));
        }
        let diagnostics = control.diagnostics();
        assert!(diagnostics.callback_allocation_count >= 1);
    }
}
