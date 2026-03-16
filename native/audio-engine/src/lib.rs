mod decoder;
mod fft;
mod player;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use player::{InnerPlayer, PlayerState};

/// 音频元数据，返回给 JS 侧
#[napi(object)]
pub struct JsAudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 时长（秒）
    pub duration: f64,
    /// 采样率
    pub sample_rate: u32,
    /// 声道数
    pub channels: u32,
}

/// 播放器状态快照，返回给 JS 侧
#[napi(object)]
pub struct JsPlayerStatus {
    /// 播放状态："idle" | "playing" | "paused" | "stopped"
    pub state: String,
    /// 当前播放位置（秒）
    pub position: f64,
    /// 总时长（秒）
    pub duration: f64,
    /// 音量（0.0 ~ 1.0）
    pub volume: f64,
    /// 是否已播放完毕
    pub is_finished: bool,
}

/// 音频播放器，通过 napi-rs 暴露给 Node.js
#[napi]
pub struct AudioPlayer {
    inner: Mutex<InnerPlayer>,
}

#[napi]
impl AudioPlayer {
    /// 创建新的播放器实例
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self {
            inner: Mutex::new(inner),
        })
    }

    /// 加载音频源（本地路径或网络地址）并开始播放，返回音频元数据
    #[napi]
    pub fn load(&self, source: String) -> Result<JsAudioMetadata> {
        let mut player = self.inner.lock();
        let metadata = player
            .load(&source)
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(JsAudioMetadata {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration_secs,
            sample_rate: metadata.sample_rate,
            channels: metadata.channels as u32,
        })
    }

    /// 恢复播放。如果已停止或播放结束，自动从头重新加载。
    #[napi]
    pub fn play(&self) -> Result<()> {
        self.inner
            .lock()
            .play()
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 暂停播放
    #[napi]
    pub fn pause(&self) {
        self.inner.lock().pause();
    }

    /// 停止播放并释放资源
    #[napi]
    pub fn stop(&self) {
        self.inner.lock().stop();
    }

    /// 跳转到指定播放位置（秒）
    #[napi]
    pub fn seek(&self, position: f64) -> Result<()> {
        self.inner
            .lock()
            .seek(position)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 设置音量（0.0 ~ 1.0）
    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.inner.lock().set_volume(volume as f32);
    }

    /// 获取当前音量（0.0 ~ 1.0）
    #[napi]
    pub fn get_volume(&self) -> f64 {
        self.inner.lock().volume() as f64
    }

    /// 获取当前播放位置（秒）
    #[napi]
    pub fn get_position(&self) -> f64 {
        self.inner.lock().position()
    }

    /// 获取总时长（秒）
    #[napi]
    pub fn get_duration(&self) -> f64 {
        self.inner.lock().duration()
    }

    /// 获取当前播放状态快照
    #[napi]
    pub fn get_status(&self) -> JsPlayerStatus {
        let player = self.inner.lock();
        JsPlayerStatus {
            state: match player.state() {
                PlayerState::Idle => "idle".to_string(),
                PlayerState::Playing => "playing".to_string(),
                PlayerState::Paused => "paused".to_string(),
                PlayerState::Stopped => "stopped".to_string(),
            },
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
        }
    }

    /// 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
    #[napi]
    pub fn get_fft_data(&self) -> Vec<f64> {
        self.inner
            .lock()
            .fft_data()
            .into_iter()
            .map(|v| v as f64)
            .collect()
    }
}
