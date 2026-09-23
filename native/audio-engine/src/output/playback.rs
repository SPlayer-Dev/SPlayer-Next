use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use cpal::traits::StreamTrait;
use tracing::warn;

use crate::decoder::buffer::Shared;
use crate::decoder::transition_source::{TransitionControl, TransitionSource as DecoderSource};
use crate::dsp::fft::FftAnalyzer;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::output::{AudioOutput, OutputStream};

/// 平台统一的播放控制句柄：持有一条独立输出流（cpal 共享流或 WASAPI 独占流）
/// 每次加载/seek 由 `attach` 创建，播放期间音量与停止通过原子标志与实时回调通信
pub struct PlaybackHandle {
    stream: OutputStream,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    transition: TransitionControl,
}

impl PlaybackHandle {
    /// 在启动解码前以暂停状态打开输出，确保独占回退后的格式用于重采样
    pub fn prepare(
        output: AudioOutput,
        fft: Arc<FftAnalyzer>,
    ) -> Result<(AudioOutput, Arc<Shared>, Arc<Self>)> {
        Self::prepare_with_buffer(output, fft, None)
    }

    /// 复用预载 PCM；设备协商格式不一致时使用新的缓冲区
    pub fn prepare_with_buffer(
        mut output: AudioOutput,
        fft: Arc<FftAnalyzer>,
        prepared: Option<Arc<Shared>>,
    ) -> Result<(AudioOutput, Arc<Shared>, Arc<Self>)> {
        let shared = prepared
            .filter(|shared| {
                shared.sample_rate() == output.sample_rate()
                    && shared.channels() == output.channels()
            })
            .unwrap_or_else(|| Shared::new(output.sample_rate(), output.channels()));

        let source = DecoderSource::new(Arc::clone(&shared), Arc::clone(&fft));
        match Self::attach(&output, source, 1.0, true) {
            Ok(playback) => Ok((output, shared, Arc::new(playback))),
            Err(error) => {
                let Some((on_fallback, reason)) = output.fallback_to_shared(&error) else {
                    return Err(error);
                };
                let shared = Shared::new(output.sample_rate(), output.channels());
                let source = DecoderSource::new(Arc::clone(&shared), fft);
                let playback = Self::attach(&output, source, 1.0, true)?;
                on_fallback(reason);
                Ok((output, shared, Arc::new(playback)))
            }
        }
    }

    /// 提交已准备的输出流，在代次校验后才允许开始消费音频样本
    pub fn activate(&self, volume: f32, paused: bool) -> Result<()> {
        self.set_volume(volume);
        if !paused {
            self.stream
                .play()
                .context("启动音频输出失败")
                .with_audio_kind(AudioErrorKind::Device)?;
        }
        Ok(())
    }

    /// 按 `output` 的配置创建输出流并接入 `source`
    /// 传入 `volume` 为初始音量，`paused` 为 true 时保持暂停（恢复时由 `play` 启动）
    pub fn attach(
        output: &AudioOutput,
        source: DecoderSource,
        volume: f32,
        paused: bool,
    ) -> Result<Self> {
        let volume = Arc::new(AtomicU32::new(volume.to_bits()));
        let stopped = Arc::new(AtomicBool::new(false));
        let transition = source.control();
        let stream =
            output.build_stream(source, Arc::clone(&volume), Arc::clone(&stopped), paused)?;
        if !paused {
            stream
                .play()
                .context("启动音频输出失败")
                .with_audio_kind(AudioErrorKind::Device)?;
        }
        Ok(Self {
            stream,
            volume,
            stopped,
            transition,
        })
    }

    /// 将备用 PCM 提交到现有输出流，由回调按音频帧执行过渡
    pub fn queue_transition(
        &self,
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        earliest_sample: u64,
        latest_sample: u64,
        fade_samples: u64,
    ) -> Result<Arc<AtomicBool>> {
        self.transition.drain_retired();
        self.transition
            .queue(shared, fft, earliest_sample, latest_sample, fade_samples)
    }

    /// 在非实时线程回收已经退出混音的旧音源
    pub fn drain_retired(&self) {
        self.transition.drain_retired();
    }

    pub fn play(&self) {
        if let Err(error) = self.stream.play() {
            warn!(%error, "恢复音频输出失败");
        }
    }

    pub fn pause(&self) {
        if let Err(error) = self.stream.pause() {
            warn!(%error, "暂停音频输出失败");
        }
    }

    /// 停止播放：实时回调转入静音填充，随句柄销毁释放输出流
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    pub fn set_volume(&self, volume: f32) {
        self.volume.store(volume.to_bits(), Ordering::Relaxed);
    }
}

impl OutputStream {
    fn play(&self) -> Result<()> {
        match self {
            Self::Shared(stream) => stream.play().map_err(Into::into),
            #[cfg(target_os = "windows")]
            Self::Exclusive(stream) => {
                stream.play();
                Ok(())
            }
        }
    }

    fn pause(&self) -> Result<()> {
        match self {
            Self::Shared(stream) => stream.pause().map_err(Into::into),
            #[cfg(target_os = "windows")]
            Self::Exclusive(stream) => {
                stream.pause();
                Ok(())
            }
        }
    }
}
