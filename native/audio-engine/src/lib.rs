mod decoder;
mod fft;
mod metadata;
mod player;

use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use player::{InnerPlayer, PlayerEvent, PlayerState};

/// 一条外部歌词，返回给 JS 侧
#[napi(object)]
pub struct JsExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc", "qrc"）
    pub format: String,
    /// 歌词内容
    pub content: String,
}

/// 歌曲完整元信息，返回给 JS 侧（load 时一次性返回）
#[napi(object)]
pub struct JsMusicMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 时长（秒）
    pub duration: f64,
    /// 采样率
    pub sample_rate: u32,
    /// 声道数
    pub channels: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词（从音频文件 tag 中读取）
    pub embedded_lyric: Option<String>,
    /// 同目录下找到的所有歌词文件
    pub external_lyrics: Vec<JsExternalLyric>,
    /// 封面缩略图路径（300x300，用于前端日常显示）
    pub cover: Option<String>,
}

/// 播放器事件，推送给 JS 侧
#[napi(object)]
pub struct JsPlayerEvent {
    /// 事件类型："stateChanged" | "ended" | "position"
    #[napi(js_name = "type")]
    pub event_type: String,
    /// 状态（仅 stateChanged 时有值）
    pub state: Option<String>,
    /// 位置（秒，仅 position 时有值）
    pub position: Option<f64>,
    /// 时长（秒，仅 position 时有值）
    pub duration: Option<f64>,
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

    /// 重新初始化音频输出设备（系统休眠唤醒后调用）
    #[napi]
    pub fn reinit_output(&self) -> Result<()> {
        self.inner
            .lock()
            .reinit_output()
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 设置封面缓存目录（在 load 前调用一次即可）
    #[napi]
    pub fn set_cover_cache_dir(&self, dir: String) {
        self.inner.lock().set_cover_cache_dir(dir);
    }

    /// 注册事件回调，Rust 侧会在状态变化、位置更新、播放结束时主动调用
    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let tsfn = callback
            .build_threadsafe_function()
            .build()?;

        // 用闭包包裹 tsfn，在内部做 PlayerEvent → JsPlayerEvent 转换
        let emitter: player::EventEmitter = Arc::new(move |event: PlayerEvent| {
            let js_event = match event {
                PlayerEvent::StateChanged { state } => JsPlayerEvent {
                    event_type: "stateChanged".to_string(),
                    state: Some(state.to_string()),
                    position: None,
                    duration: None,
                },
                PlayerEvent::Ended => JsPlayerEvent {
                    event_type: "ended".to_string(),
                    state: None,
                    position: None,
                    duration: None,
                },
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".to_string(),
                    state: None,
                    position: Some(position),
                    duration: Some(duration),
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        self.inner.lock().set_event_callback(emitter);
        Ok(())
    }

    /// 加载音频源并开始播放，返回完整元信息（含封面路径和歌词）
    #[napi]
    pub fn load(&self, source: String) -> Result<JsMusicMetadata> {
        let mut player = self.inner.lock();
        let meta = player
            .load(&source)
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(JsMusicMetadata {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            duration: meta.duration_secs,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u32,
            bit_rate: meta.bit_rate,
            codec: meta.codec,
            embedded_lyric: meta.embedded_lyric,
            external_lyrics: meta
                .external_lyrics
                .into_iter()
                .map(|l| JsExternalLyric {
                    format: l.format,
                    content: l.content,
                })
                .collect(),
            cover: meta.cover,
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

    /// 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用渐变
    #[napi]
    pub fn set_fade_duration(&self, duration_ms: f64) {
        self.inner.lock().set_fade_duration(duration_ms as u64);
    }

    /// 获取当前渐变时长（毫秒）
    #[napi]
    pub fn get_fade_duration(&self) -> f64 {
        self.inner.lock().fade_duration() as f64
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

    /// 按需从音频文件提取原始高清封面（用于 SMTC / 全屏播放器）。
    /// 不缓存到磁盘，返回原始图片字节。
    #[napi]
    pub fn get_cover_raw(&self) -> Option<napi::bindgen_prelude::Buffer> {
        let source = self.inner.lock().current_source()?.to_string();
        let data = metadata::extract_cover_raw(&source)?;
        Some(data.into())
    }
}
