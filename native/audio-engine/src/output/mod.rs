//! 跨平台统一的音频输出（纯 cpal，无 rodio）。
//!
//! cpal 0.18 起各后端的 `Stream` 均为 `Send`，可直接由 `PlaybackHandle` 持有，
//! 无需再为 `!Send` 做专用线程隔离。`AudioOutput` 只负责解析输出设备与配置：
//! 流采样率是播放重采样目标，不等同于音频服务器图或硬件采样率。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig, SupportedStreamConfig};
use tracing::{debug, info, warn};

use crate::decoder::transition_source::TransitionSource as DecoderSource;
use crate::error::{AudioErrorKind, AudioResultExt};

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
    Exclusive(crate::output::wasapi::ExclusiveStream),
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
    exclusive: Option<crate::output::wasapi::ExclusiveFormat>,
    /// 该输出流的单调代次，用于诊断和过滤销毁后迟到的流错误
    generation: u64,
    on_failure: OutputFailureCallback,
    #[cfg(target_os = "windows")]
    on_fallback: Option<ExclusiveFallbackCallback>,
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
        let (device, config, _exclusive_format) =
            open_device(device_id, requested_sample_rate, source_bits, exclusive)
                .with_audio_kind(AudioErrorKind::Device)?;
        #[cfg(target_os = "windows")]
        if let Some(format) = _exclusive_format {
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
        if _exclusive_format.is_none() {
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
            exclusive: _exclusive_format,
            generation,
            on_failure,
            #[cfg(target_os = "windows")]
            on_fallback: exclusive.cloned(),
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

    /// 实际输出设备名称
    pub fn device_name(&self) -> String {
        self.device
            .description()
            .ok()
            .map(|desc| desc.name().to_owned())
            .unwrap_or_else(|| self.device.to_string())
    }

    /// 是否处于独占模式输出
    pub fn is_exclusive(&self) -> bool {
        #[cfg(target_os = "windows")]
        return self.exclusive.is_some();
        #[cfg(not(target_os = "windows"))]
        false
    }

    /// 实际输出流有效位深（bits）
    pub fn bits(&self) -> u32 {
        #[cfg(target_os = "windows")]
        if let Some(format) = &self.exclusive {
            return format.valid_bits as u32;
        }
        self.config.sample_format().sample_size() as u32 * 8
    }

    /// 实际开流失败时切换到共享格式；调用方必须按新格式重新创建样本缓冲。
    pub(crate) fn fallback_to_shared(
        &mut self,
        error: &anyhow::Error,
    ) -> Option<(ExclusiveFallbackCallback, &'static str)> {
        #[cfg(target_os = "windows")]
        if self.exclusive.take().is_some() {
            let reason = crate::output::wasapi::fallback_reason(error);
            warn!(reason, error = %error, "独占模式开流失败，尝试共享模式");
            return self.on_fallback.clone().map(|callback| (callback, reason));
        }
        let _ = error;
        None
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
                crate::output::wasapi::open_exclusive_stream(
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

mod cpal_stream;
mod device;
pub(crate) mod device_watcher;
#[cfg(any(target_os = "linux", test))]
mod pipewire;
pub(crate) mod playback;
mod thread;
#[cfg(target_os = "windows")]
pub(crate) mod wasapi;

use cpal_stream::build_typed_stream_for_format;
pub use device::{default_device_id, default_device_name, list_output_devices};
use device::{device_id_string, open_device};
use thread::run_in_mta;
