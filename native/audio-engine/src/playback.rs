use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use cpal::traits::StreamTrait;
use tracing::warn;

use crate::audio_output::{AudioOutput, OutputStream};
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::source::DecoderSource;

/// 平台统一的播放控制句柄：持有一条独立输出流（cpal 共享流或 WASAPI 独占流）。
/// 每次加载/seek 由 `attach` 创建，播放期间音量与停止通过原子标志与实时回调通信。
pub struct PlaybackHandle {
    stream: OutputStream,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
}

impl PlaybackHandle {
    /// 按 `output` 的配置创建输出流并接入 `source`。
    /// 传入 `volume` 为初始音量，`paused` 为 true 时保持暂停（恢复时由 `play` 启动）。
    pub fn attach(
        output: &AudioOutput,
        source: DecoderSource,
        volume: f32,
        paused: bool,
    ) -> Result<Self> {
        let volume = Arc::new(AtomicU32::new(volume.to_bits()));
        let stopped = Arc::new(AtomicBool::new(false));
        let stream = output.build_stream(source, Arc::clone(&volume), Arc::clone(&stopped), paused)?;
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
        })
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
