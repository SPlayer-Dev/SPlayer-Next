//! 跨平台统一的音频输出（纯 cpal，无 rodio）。
//!
//! cpal 0.18 起各后端的 `Stream` 均为 `Send`，可直接由 `PlaybackHandle` 持有，
//! 无需再为 `!Send` 做专用线程隔离。`AudioOutput` 只负责解析输出设备与配置：
//! 设备采样率即播放重采样目标，每次加载/seek 音源时按该配置创建独立输出流。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig, SupportedStreamConfig};
use tracing::{debug, info, warn};

use crate::error::{AudioErrorKind, AudioResultExt};
use crate::source::DecoderSource;

/// 输出失败回调：实时错误线程调用，只允许发送轻量事件。
/// 禁止获取 `InnerPlayer` 锁、join 线程、枚举设备、创建新流或调用 NAPI async 方法。
pub type OutputFailureCallback = Arc<dyn Fn() + Send + Sync + 'static>;

/// 独占模式回退回调：参数为回退原因分类键（deviceBusy / formatUnsupported / unavailable），
/// 由协商失败的工作线程调用，只允许发送轻量事件
pub type ExclusiveFallbackCallback = Arc<dyn Fn(&str) + Send + Sync + 'static>;

/// 平台输出流：共享模式走 cpal，Windows 独占模式走 WASAPI 专属流
pub(crate) enum OutputStream {
    Shared(cpal::Stream),
    #[cfg(target_os = "windows")]
    Exclusive(crate::wasapi_exclusive::ExclusiveStream),
}

/// 输出设备与配置句柄。`Send`，可放进 `InnerPlayer` 而不需 `unsafe impl Send`。
///
/// 不持有输出流——输出流由每次加载音源时的 `PlaybackHandle::attach` 按此配置创建，
/// 因此切歌时无需跨线程移交流，也天然避免新旧流重叠占用设备。
pub struct AudioOutput {
    device: cpal::Device,
    config: SupportedStreamConfig,
    /// Windows 独占模式协商结果；`Some` 时输出走 WASAPI 独占流
    #[cfg(target_os = "windows")]
    exclusive: Option<crate::wasapi_exclusive::ExclusiveFormat>,
    /// 该输出流的单调代次，用于诊断和过滤销毁后迟到的流错误
    generation: u64,
    on_failure: OutputFailureCallback,
}

impl AudioOutput {
    /// 解析输出设备与配置
    ///
    /// # Arguments
    /// * `device_id` - 输出设备 ID，`None` 走系统默认设备
    /// * `requested_sample_rate` - 期望输出采样率；设备支持时按此速率打开（音源精确采样率），
    ///   否则回退到设备默认配置。`None` 表示直接用设备默认配置
    /// * `source_bits` - 音源位深，独占模式协商候选的优先依据
    /// * `generation` - 输出流单调代次，见 [`AudioOutput`] 字段说明
    /// * `on_failure` - 运行期流错误回调，见 [`OutputFailureCallback`]
    /// * `exclusive` - 独占模式开关，`Some` 携带回退回调；协商失败时自动回退共享并上报
    ///
    /// # Errors
    /// - 找不到指定设备
    /// - 无可用音频设备
    pub fn new(
        device_id: Option<&str>,
        requested_sample_rate: Option<u32>,
        source_bits: Option<u32>,
        generation: u64,
        on_failure: OutputFailureCallback,
        exclusive: Option<&ExclusiveFallbackCallback>,
    ) -> Result<Self> {
        let (device, config, exclusive_format) = open_device(
            device_id,
            requested_sample_rate,
            source_bits,
            exclusive,
        )
        .with_audio_kind(AudioErrorKind::Device)?;
        #[cfg(not(target_os = "windows"))]
        let _ = exclusive_format;
        #[cfg(target_os = "windows")]
        if let Some(format) = exclusive_format {
            info!(
                id = device_id_string(&device).as_deref().unwrap_or("-"),
                name = %device,
                rate = format.sample_rate,
                channels = format.channels,
                bits = format.valid_bits,
                "打开独占模式音频输出配置"
            );
        }
        #[cfg(target_os = "windows")]
        if exclusive_format.is_none() {
            info!(
                id = device_id_string(&device).as_deref().unwrap_or("-"),
                name = %device,
                sample_rate = config.sample_rate(),
                "打开音频输出配置"
            );
        }
        #[cfg(not(target_os = "windows"))]
        info!(
            id = device_id_string(&device).as_deref().unwrap_or("-"),
            name = %device,
            sample_rate = config.sample_rate(),
            "打开音频输出配置"
        );
        Ok(Self {
            device,
            config,
            #[cfg(target_os = "windows")]
            exclusive: exclusive_format,
            generation,
            on_failure,
        })
    }

    /// 实际输出流采样率（播放重采样目标）
    pub fn sample_rate(&self) -> u32 {
        #[cfg(target_os = "windows")]
        if let Some(format) = &self.exclusive {
            return format.sample_rate;
        }
        self.config.sample_rate()
    }

    /// 实际输出流声道数
    pub fn channels(&self) -> u16 {
        #[cfg(target_os = "windows")]
        if let Some(format) = &self.exclusive {
            return format.channels;
        }
        self.config.channels()
    }

    /// 按本配置创建一次播放的输出流，实时回调从 `source` 拉取样本。
    /// 调用方持有返回的流，直到本次播放结束。
    pub(crate) fn build_stream(
        &self,
        source: DecoderSource,
        volume: Arc<AtomicU32>,
        stopped: Arc<AtomicBool>,
        paused: bool,
    ) -> Result<OutputStream> {
        #[cfg(target_os = "windows")]
        if let Some(format) = self.exclusive {
            let device_id = device_id_string(&self.device);
            let on_failure = Arc::clone(&self.on_failure);
            return run_in_mta(move || {
                crate::wasapi_exclusive::open_exclusive_stream(
                    device_id.as_deref(),
                    format,
                    source,
                    volume,
                    stopped,
                    paused,
                    on_failure,
                )
                .map(OutputStream::Exclusive)
            })
            .with_audio_kind(AudioErrorKind::Device);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = paused;
        let device = self.device.clone();
        let config = self.config;
        let on_failure = Arc::clone(&self.on_failure);
        run_in_mta(move || {
            build_typed_stream_for_format(&device, &config, source, volume, stopped, on_failure)
        })
        .map(OutputStream::Shared)
        .with_audio_kind(AudioErrorKind::Device)
    }
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        debug!(generation = self.generation, "释放音频输出配置");
    }
}

/// 常驻 MTA 工作线程，所有 cpal 调用都派给它执行。
///
/// cpal 的 `com_initialized()` 会把首次触碰的线程初始化成 STA；cpal 的
/// `IMMDeviceEnumerator` 又是进程级单例，创建时所处的 apartment 决定它此后能否跨线程
/// 安全使用。一条永不退出、永不 `CoUninitialize` 的 MTA 线程同时收口这两点，并保证进程
/// MTA 不会在两次调用之间被拆掉——`AudioOutput` 持有的 `cpal::Device` 里缓存着在该
/// apartment 里激活的 `IAudioClient`。
#[cfg(target_os = "windows")]
mod mta {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::mpsc::{channel, sync_channel, SyncSender};
    use std::sync::OnceLock;
    use std::thread;

    use anyhow::{anyhow, Result};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    type Job = Box<dyn FnOnce() + Send + 'static>;

    static WORKER: OnceLock<Option<SyncSender<Job>>> = OnceLock::new();

    fn worker() -> Result<&'static SyncSender<Job>> {
        WORKER
            .get_or_init(|| {
                let (job_tx, job_rx) = sync_channel::<Job>(1);
                thread::Builder::new()
                    .name("audio-mta-worker".into())
                    .spawn(move || {
                        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                        for job in job_rx {
                            // cpal 的设备枚举路径上有 unwrap/expect，单个任务 panic 不能带走整条线程
                            let _ = catch_unwind(AssertUnwindSafe(job));
                        }
                    })
                    .ok()
                    .map(|_| job_tx)
            })
            .as_ref()
            .ok_or_else(|| anyhow!("启动 MTA 线程失败"))
    }

    /// 把 `f` 派给 MTA 线程执行并等待结果。调用按到达顺序串行执行
    pub(super) fn run<T: Send + 'static>(
        f: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (result_tx, result_rx) = channel();
        worker()?
            .send(Box::new(move || {
                let _ = result_tx.send(f());
            }))
            .map_err(|_| anyhow!("MTA 线程已退出"))?;
        result_rx.recv().map_err(|_| anyhow!("MTA 线程发生 panic"))?
    }
}

#[cfg(target_os = "windows")]
use mta::run as run_in_mta;

#[cfg(not(target_os = "windows"))]
fn run_in_mta<T, F: FnOnce() -> Result<T>>(f: F) -> Result<T> {
    f()
}

/// 设备显示名：cpal 0.18 起 `Device::name()` 并入 `description().name()`。
/// 可能重复、可被用户改名，只用于展示和旧配置回退匹配
fn persisted_device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|desc| desc.name().to_owned())
}

/// 设备稳定 ID：WASAPI 端点 ID / CoreAudio UID / PipeWire node.name，跨重启和改名都稳定
fn device_id_string(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

/// cpal 的 PipeWire 后端会合成「跟随系统默认」的哨兵设备，它们不对应真实节点，
/// 选择系统默认时由 `open_device(None)` 取用，不应混进给用户挑选的设备列表
fn is_synthetic_default_device(name: &str) -> bool {
    cfg!(target_os = "linux") && matches!(name, "default_output" | "default_sink")
}

/// 按选择器查找输出设备，优先按稳定 ID 匹配，失败后回退到显示名。
///
/// 回退是为 1.0.0 及更早版本存下的显示名配置准备的：命中后由 JS 侧改写成 ID。
/// 显示名可能重复，回退路径取首个匹配，因此仅用于迁移，不作为长期身份。
fn find_device(host: &cpal::Host, selector: &str) -> Option<cpal::Device> {
    if let Ok(parsed) = selector.parse::<cpal::DeviceId>() {
        return host.device_by_id(&parsed);
    }
    host.output_devices()
        .ok()?
        .find(|device| persisted_device_name(device).as_deref() == Some(selector))
}

/// 枚举所有输出设备，返回 `(id, name, is_default)` 列表
/// 纯查询，不涉及流状态，调用方任意线程都能用
pub fn list_output_devices() -> Vec<(String, String, bool)> {
    run_in_mta(|| {
        let host = cpal::default_host();
        let default_id = host
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        let list = host
            .output_devices()
            .map(|devices| {
                devices
                    .filter_map(|device| {
                        let name = persisted_device_name(&device)?;
                        if is_synthetic_default_device(&name) {
                            return None;
                        }
                        let id = device_id_string(&device)?;
                        let is_default = default_id.as_deref() == Some(id.as_str());
                        Some((id, name, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default();
        debug!(
            default_id = default_id.as_deref().unwrap_or("-"),
            devices = ?list,
            "枚举音频输出设备"
        );
        Ok(list)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备名
pub fn default_device_name() -> Option<String> {
    run_in_mta(|| {
        let name = cpal::default_host()
            .default_output_device()
            .and_then(|device| persisted_device_name(&device));
        Ok(name)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备稳定 ID，供主进程做切换检测（显示名可重复、可被改名）
pub fn default_device_id() -> Option<String> {
    run_in_mta(|| {
        let id = cpal::default_host()
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        Ok(id)
    })
    .unwrap_or_default()
}

/// 独占模式协商结果类型：非 Windows 平台无此概念
#[cfg(target_os = "windows")]
type ExclusiveFormatOpt = Option<crate::wasapi_exclusive::ExclusiveFormat>;
#[cfg(not(target_os = "windows"))]
type ExclusiveFormatOpt = ();

/// 按设备 ID（`None` 为默认设备）解析设备与输出配置。
/// 设备支持 `requested_sample_rate` 时按该速率打开，否则使用设备默认配置。
/// 样本格式优先沿用设备默认格式：PipeWire 等后端上报的 supported 列表包含
/// 全部合成格式（顺序 I8…F64），首个条目不代表设备真实能力，直接采用会导致
/// 以 i8 打开输出流而严重劣化音质。
fn open_device_internal(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
    source_bits: Option<u32>,
    exclusive: Option<&ExclusiveFallbackCallback>,
) -> Result<(cpal::Device, SupportedStreamConfig, ExclusiveFormatOpt)> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(selector) => {
            find_device(&host, selector).with_context(|| format!("输出设备 '{selector}' 不存在"))?
        }
        None => {
            let default = host.default_output_device().context("没有可用的输出设备")?;
            let default_id = device_id_string(&default).context("读取默认输出设备 ID 失败")?;
            find_device(&host, &default_id).context("解析默认输出设备端点失败")?
        }
    };
    let default_config = device
        .default_output_config()
        .context("读取输出设备配置失败")?;

    #[cfg(target_os = "windows")]
    {
        let _ = requested_sample_rate;
        let mut exclusive_format = None;
        if let Some(on_fallback) = exclusive {
            // 独占模式：优先按音源采样率/位深协商，失败时回退共享并上报原因
            match crate::wasapi_exclusive::negotiate_exclusive_format(
                device_id_string(&device).as_deref(),
                requested_sample_rate.unwrap_or(default_config.sample_rate()),
                source_bits.unwrap_or(24),
                default_config.channels(),
            ) {
                Ok(format) => exclusive_format = Some(format),
                Err(error) => {
                    warn!(reason = error.reason(), error = %error, "独占模式协商失败，回退共享模式");
                    on_fallback(error.reason());
                }
            }
        }
        Ok((device, default_config, exclusive_format))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (source_bits, exclusive);
        let config = match requested_sample_rate {
            Some(rate) => {
                if rate == default_config.sample_rate() {
                    default_config
                } else {
                    let default_format = default_config.sample_format();
                    let default_channels = default_config.channels();
                    let at_rate = device.supported_output_configs().ok().and_then(|configs| {
                        let configs: Vec<_> = configs.collect();
                        configs
                            .iter()
                            .copied()
                            .find(|range| {
                                range.min_sample_rate() <= rate
                                    && rate <= range.max_sample_rate()
                                    && range.sample_format() == default_format
                                    && range.channels() == default_channels
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.sample_format() == default_format
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.channels() == default_channels
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                })
                            })
                            .map(|range| range.with_sample_rate(rate))
                    });
                    at_rate.unwrap_or(default_config)
                }
            }
            None => default_config,
        };
        Ok((device, config, ()))
    }
}

fn open_device(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
    source_bits: Option<u32>,
    exclusive: Option<&ExclusiveFallbackCallback>,
) -> Result<(cpal::Device, SupportedStreamConfig, ExclusiveFormatOpt)> {
    let id_owned = device_id.map(String::from);
    // 回退回调只在 MTA 工作线程被调用，Arc 在此克隆进闭包
    let fallback_owned = exclusive.cloned();
    run_in_mta(move || {
        open_device_internal(
            id_owned.as_deref(),
            requested_sample_rate,
            source_bits,
            fallback_owned.as_ref(),
        )
    })
}

/// 按样本格式分发到类型化构建
fn build_typed_stream_for_format(
    device: &cpal::Device,
    config: &SupportedStreamConfig,
    source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream> {
    let sample_format = config.sample_format();
    let config: StreamConfig = config.config();
    macro_rules! build {
        ($sample:ty) => {
            build_typed_stream::<$sample>(device, config, source, volume, stopped, on_failure)
        };
    }
    match sample_format {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I24 => build!(cpal::I24),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        _ => Err(anyhow!("不支持的输出样本格式: {sample_format}")),
    }
}

fn build_typed_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream>
where
    T: SizedSample + Sample + FromSample<f32>,
{
    let stream = device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            let gain = f32::from_bits(volume.load(Ordering::Relaxed));
            if stopped.load(Ordering::Acquire) {
                data.fill(T::EQUILIBRIUM);
                return;
            }
            for output in data {
                *output = T::from_sample(source.next().unwrap_or(0.0) * gain);
            }
        },
        move |error| {
            let err_msg = error.to_string();
            // 设备失效的两种上报文本：默认设备监听的 "no longer valid"，以及绑定端点被拔出时
            // GetCurrentPadding 返回 0x88890004 (AUDCLNT_E_DEVICE_INVALIDATED) 的十进制 OS Error。
            // 均属预期失效，重建即可
            let invalidated =
                err_msg.contains("no longer valid") || err_msg.contains("-2004287484");
            if invalidated {
                info!("音频输出流因设备切换失效，准备重建");
            } else {
                warn!(%error, "音频输出流失败");
            }
            on_failure();
        },
        None,
    )?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_synthetic_default_devices_from_the_selectable_list() {
        assert_eq!(
            is_synthetic_default_device("default_output"),
            cfg!(target_os = "linux")
        );
        assert_eq!(
            is_synthetic_default_device("default_sink"),
            cfg!(target_os = "linux")
        );
    }

    #[test]
    fn keeps_real_devices_in_the_selectable_list() {
        assert!(!is_synthetic_default_device("Built-in Audio Analog Stereo"));
        assert!(!is_synthetic_default_device("扬声器 (Realtek(R) Audio)"));
    }

    /// `find_device` 先按 `DeviceId` 解析、失败才回退显示名，旧配置存的显示名必须落到回退分支
    #[test]
    fn legacy_display_names_do_not_parse_as_device_ids() {
        assert!("扬声器 (Realtek(R) Audio)"
            .parse::<cpal::DeviceId>()
            .is_err());
        assert!("Built-in Audio Analog Stereo"
            .parse::<cpal::DeviceId>()
            .is_err());
        assert!("AppleHDAEngineOutput:1B,0,1,0:0"
            .parse::<cpal::DeviceId>()
            .is_err());
    }
}
