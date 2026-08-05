//! FFmpeg 音频解码 + CPAL 输出 + FFT 频谱分析。
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

mod audio_output;
mod decoder;
mod device_watcher;
mod equalizer;
mod error;
mod fft;
mod http_source;
mod logger;
mod loudness;
mod metadata;
mod player;
mod scanner;
mod shared;
mod source;
mod tag_editor;
mod tempo;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Once};
use std::thread::{self, JoinHandle};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::equalizer::EQ_BAND_COUNT;
use player::{InnerPlayer, PlayerController, PlayerEvent, PlayerState, SeekTake};

/// async seek 阶段 2 的输出
enum SeekOutcome {
    /// seek 成功 + 已启动新解码线程
    Resumed {
        shared: Arc<crate::shared::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
    },
    /// seek 失败，需要 fallback 到完整 load
    Fallback,
}

/// 全局扫描取消标志
static SCAN_CANCEL: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

const LOAD_SUPERSEDED_CODE: &str = "LOAD_SUPERSEDED";

/// anyhow::Error → napi::Error 统一转换。
///
/// 经 `AudioEngineError::classify` 按错误链中的具体类型分类，错误消息附带 `[CODE]` 前缀，
/// JS 侧可解析稳定 code 走分支。
trait IntoNapiResult<T> {
    fn into_napi(self) -> napi::Result<T>;
}

fn invalid_argument(message: &str) -> Error {
    let error = crate::error::AudioEngineError::InvalidArgument(message.to_string());
    Error::from_reason(format!("[{}] {error}", error.code()))
}

fn load_superseded_error() -> Error {
    let error = crate::error::AudioEngineError::LoadSuperseded;
    Error::from_reason(format!("[{}] {error}", error.code()))
}

fn internal_error(message: impl Into<String>) -> Error {
    let error = crate::error::AudioEngineError::Internal(message.into());
    Error::from_reason(format!("[{}] {error}", error.code()))
}

fn is_load_superseded(error: &Error) -> bool {
    error
        .reason
        .strip_prefix('[')
        .and_then(|reason| reason.split_once(']'))
        .is_some_and(|(code, _)| code == LOAD_SUPERSEDED_CODE)
}

impl<T> IntoNapiResult<T> for anyhow::Result<T> {
    fn into_napi(self) -> napi::Result<T> {
        self.map_err(|err| {
            let classified = crate::error::AudioEngineError::classify(&err);
            Error::from_reason(format!("[{}] {classified}", classified.code()))
        })
    }
}

/// 初始化原生日志系统。重复调用是无害的（HMR 重载时主进程可能多次注入）
#[napi]
pub fn init_logger(log_dir: String, is_dev: bool) {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        logger::init_logger(&log_dir, is_dev);
        ffmpeg_audio::log::set_log_level(ffmpeg_audio::sys::LogLevel::Fatal);
        info!(log_dir, is_dev, "audio-engine 日志系统已初始化");
    });
}

/// 一条外部歌词，返回给 JS 侧（仅格式和路径，内容按需加载）
#[napi(object)]
pub struct JsExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc", "qrc"）
    pub format: String,
    /// 文件路径
    pub path: String,
}

/// 歌曲完整元信息，返回给 JS 侧（load 时一次性返回）
#[napi(object)]
pub struct JsMusicMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    /// 时长（秒）
    pub duration: f64,
    /// 播放采样率（重采样后）
    pub sample_rate: u32,
    /// 声道数
    pub channels: u32,
    /// 原始采样率（解码前，用于音质显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
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

/// 音频输出设备信息
#[napi(object)]
pub struct JsAudioDevice {
    /// CPAL 提供的稳定设备 ID，用于持久化选择
    pub id: String,
    pub name: String,
    /// CPAL host 标识
    pub host: String,
    /// 是否为系统默认设备
    pub is_default: bool,
}

/// FFT 双声道频谱数据
#[napi(object)]
pub struct JsFftData {
    pub ldata: Vec<f64>,
    pub rdata: Vec<f64>,
}

/// 播放器事件，推送给 JS 侧
#[napi(object)]
#[derive(Default)]
pub struct JsPlayerEvent {
    /// 事件类型："stateChanged" | "ended" | "sourceError" | "internalError" | "position" | "fftData" | "outputStalled" | "outputDeviceUnavailable" | "deviceChanged"
    #[napi(js_name = "type")]
    pub event_type: String,
    /// 状态（仅 stateChanged 时有值）
    pub state: Option<String>,
    /// 位置（秒，仅 position 时有值）
    pub position: Option<f64>,
    /// 时长（秒，仅 position 时有值）
    pub duration: Option<f64>,
    /// FFT 频谱数据（仅 fftData 时有值，128 个频段，值域 0.0 ~ 1.0）
    pub fft_data: Option<JsFftData>,
    /// 原生设备事件类型（仅 deviceChanged 时有值）
    pub device_event: Option<String>,
    /// 发生变化的 CPAL DeviceId（仅 deviceChanged 且系统提供 ID 时有值）
    pub device_id: Option<String>,
}

/// 原生音频链路的只读诊断快照。
#[napi(object)]
pub struct JsAudioDiagnostics {
    pub state: String,
    pub source_sample_rate: u32,
    pub output_sample_rate: u32,
    pub output_channels: u32,
    pub buffered_chunks: u32,
    pub submitted_samples: f64,
    pub underrun_samples: f64,
    pub xrun_count: f64,
    pub realtime_denied_count: f64,
    pub callback_allocation_count: f64,
    pub callback_max_duration_us: f64,
    pub ring_capacity_frames: f64,
    pub ring_fill_frames: f64,
    pub rebuild_attempts: f64,
    pub rebuild_failures: f64,
    pub clock_quality: String,
    pub selected_device_id: Option<String>,
    pub active_device_id: Option<String>,
}

/// 播放器状态快照
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

/// PlayerState → JS 字符串
fn state_to_str(state: PlayerState) -> &'static str {
    match state {
        PlayerState::Idle => "idle",
        PlayerState::Playing => "playing",
        PlayerState::Paused => "paused",
        PlayerState::Stopped => "stopped",
    }
}

enum EventPumpCommand {
    Critical(PlayerEvent),
    WakeLatest,
    Shutdown,
}

#[derive(Default)]
struct LatestPlayerEvents {
    position: Option<PlayerEvent>,
    fft: Option<PlayerEvent>,
}

struct EventPumpHandle {
    sender: SyncSender<EventPumpCommand>,
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for EventPumpHandle {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        let _ = self.sender.send(EventPumpCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn player_event_to_js(event: PlayerEvent) -> JsPlayerEvent {
    match event {
        PlayerEvent::StateChanged { state } => JsPlayerEvent {
            event_type: "stateChanged".into(),
            state: Some(state_to_str(state).into()),
            ..Default::default()
        },
        PlayerEvent::Ended => JsPlayerEvent {
            event_type: "ended".into(),
            ..Default::default()
        },
        PlayerEvent::SourceError => JsPlayerEvent {
            event_type: "sourceError".into(),
            ..Default::default()
        },
        PlayerEvent::InternalError => JsPlayerEvent {
            event_type: "internalError".into(),
            ..Default::default()
        },
        PlayerEvent::Position { position, duration } => JsPlayerEvent {
            event_type: "position".into(),
            position: Some(position),
            duration: Some(duration),
            ..Default::default()
        },
        PlayerEvent::FftData { ldata, rdata } => JsPlayerEvent {
            event_type: "fftData".into(),
            fft_data: Some(JsFftData {
                ldata: ldata.into_iter().map(f64::from).collect(),
                rdata: rdata.into_iter().map(f64::from).collect(),
            }),
            ..Default::default()
        },
        PlayerEvent::OutputStalled => JsPlayerEvent {
            event_type: "outputStalled".into(),
            ..Default::default()
        },
        PlayerEvent::OutputDeviceUnavailable { device_id } => JsPlayerEvent {
            event_type: "outputDeviceUnavailable".into(),
            device_id: Some(device_id),
            ..Default::default()
        },
        PlayerEvent::DeviceChanged { kind, device_id } => JsPlayerEvent {
            event_type: "deviceChanged".into(),
            device_event: Some(kind.into()),
            device_id,
            ..Default::default()
        },
    }
}

fn create_event_pump(
    callback: Function<JsPlayerEvent, ()>,
) -> Result<(player::EventEmitter, EventPumpHandle)> {
    let tsfn = callback
        .build_threadsafe_function()
        .max_queue_size::<32>()
        .build()?;
    let (sender, receiver) = mpsc::sync_channel(32);
    let latest = Arc::new(Mutex::new(LatestPlayerEvents::default()));
    let pump_latest = Arc::clone(&latest);
    let stopping = Arc::new(AtomicBool::new(false));
    let pump_stopping = Arc::clone(&stopping);
    let thread = thread::Builder::new()
        .name("audio-event-pump".to_string())
        .spawn(move || {
            while let Ok(command) = receiver.recv() {
                match command {
                    EventPumpCommand::Critical(event) => {
                        while !pump_stopping.load(Ordering::Acquire) {
                            let status = tsfn.call(
                                player_event_to_js(event.clone()),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                            if status != napi::Status::QueueFull {
                                break;
                            }
                            thread::yield_now();
                        }
                    }
                    EventPumpCommand::WakeLatest => {
                        let (position, fft) = {
                            let mut latest = pump_latest.lock();
                            (latest.position.take(), latest.fft.take())
                        };
                        if let Some(event) = position {
                            tsfn.call(
                                player_event_to_js(event),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                        if let Some(event) = fft {
                            tsfn.call(
                                player_event_to_js(event),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                    }
                    EventPumpCommand::Shutdown => break,
                }
            }
        })
        .map_err(|error| internal_error(format!("启动音频事件泵失败: {error}")))?;

    let emitter_sender = sender.clone();
    let emitter_latest = Arc::clone(&latest);
    let emitter: player::EventEmitter = Arc::new(move |event| match event {
        event @ (PlayerEvent::Position { .. } | PlayerEvent::FftData { .. }) => {
            let mut latest = emitter_latest.lock();
            match event {
                event @ PlayerEvent::Position { .. } => latest.position = Some(event),
                event @ PlayerEvent::FftData { .. } => latest.fft = Some(event),
                _ => unreachable!(),
            }
            drop(latest);
            let _ = emitter_sender.try_send(EventPumpCommand::WakeLatest);
        }
        event => {
            let _ = emitter_sender.send(EventPumpCommand::Critical(event));
        }
    });

    Ok((
        emitter,
        EventPumpHandle {
            sender,
            stopping,
            thread: Some(thread),
        },
    ))
}

/// 音频播放器，通过 napi-rs 暴露给 Node.js
#[napi]
pub struct AudioPlayer {
    inner: PlayerController,
    device_event_callback: Arc<parking_lot::RwLock<Option<player::EventEmitter>>>,
    _device_watcher: device_watcher::DeviceWatcher,
    rebuild_attempts: AtomicU64,
    rebuild_failures: AtomicU64,
    event_pump: Mutex<Option<EventPumpHandle>>,
}

#[napi]
impl AudioPlayer {
    /// 创建新的播放器实例
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = PlayerController::new().into_napi()?;
        let device_event_callback = Arc::new(parking_lot::RwLock::new(None));
        let device_watcher =
            device_watcher::DeviceWatcher::new(Arc::clone(&device_event_callback)).into_napi()?;
        info!("AudioPlayer 实例已创建");
        Ok(Self {
            inner,
            device_event_callback,
            _device_watcher: device_watcher,
            rebuild_attempts: AtomicU64::new(0),
            rebuild_failures: AtomicU64::new(0),
            event_pump: Mutex::new(None),
        })
    }

    /// 重新初始化音频输出设备（系统休眠唤醒后调用）。
    #[napi]
    pub async fn reinit_output(&self) -> Result<()> {
        info!("重新初始化音频输出设备");
        let selected_device_id = self
            .inner
            .call(|player| player.selected_device_id().map(String::from))
            .into_napi()?;
        self.rebuild_output(selected_device_id.clone(), selected_device_id)
            .await
    }

    /// 输出失效时恢复；指定设备无法重开则临时使用系统默认，同时保留用户设置。
    #[napi]
    pub async fn recover_output(&self) -> Result<()> {
        let selected_device_id = self
            .inner
            .call(|player| player.selected_device_id().map(String::from))
            .into_napi()?;
        match self
            .rebuild_output(selected_device_id.clone(), selected_device_id.clone())
            .await
        {
            Ok(()) => Ok(()),
            Err(error) if selected_device_id.is_some() => {
                let Some(device_id) = selected_device_id else {
                    return Err(error);
                };
                warn!(device = %device_id, reason = %error, "指定输出设备不可用，临时回退系统默认");
                self.inner
                    .call(move |player| player.emit_output_device_unavailable(device_id))
                    .into_napi()?;
                let expected_selection = self
                    .inner
                    .call(|player| player.selected_device_id().map(String::from))
                    .into_napi()?;
                self.rebuild_output(None, expected_selection).await
            }
            Err(error) => Err(error),
        }
    }

    async fn rebuild_output(
        &self,
        build_device_id: Option<String>,
        expected_selected_device_id: Option<String>,
    ) -> Result<()> {
        self.rebuild_attempts.fetch_add(1, Ordering::Relaxed);
        let output_device_id = build_device_id.clone();
        let output_result = tokio::task::spawn_blocking(move || {
            audio_output::AudioOutput::new(build_device_id.as_deref())
        })
        .await
        .map_err(|e| {
            self.rebuild_failures.fetch_add(1, Ordering::Relaxed);
            internal_error(format!("reinit output task join error: {e}"))
        })?;
        let new_output = match output_result {
            Ok(output) => output,
            Err(error) => {
                self.rebuild_failures.fetch_add(1, Ordering::Relaxed);
                return Err(error).into_napi();
            }
        };

        let transaction = self
            .inner
            .call(move |player| {
                if player.selected_device_id() != expected_selected_device_id.as_deref() {
                    return None;
                }
                let position = player.position();
                let was_playing = player.state() == PlayerState::Playing;
                let current_source = player.current_source();
                let take = player.take_for_async_seek();
                player.replace_output_device(new_output, output_device_id);
                let take = take.map(|mut value| {
                    value.output_sample_rate = player.output_sample_rate();
                    value
                });
                Some((take, position, was_playing, current_source))
            })
            .into_napi()?;
        let Some((take, position, was_playing, current_source)) = transaction else {
            info!("输出设备选择已变化，丢弃过期的重建结果");
            return Ok(());
        };

        let Some(take) = take else {
            return Ok(());
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source: _,
            was_playing: _,
            output_sample_rate,
            token,
        } = take;

        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            let shared =
                crate::shared::Shared::new(output_sample_rate, crate::decoder::TARGET_CHANNELS);
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            let handle =
                match crate::decoder::resume_decode(decoder_data, std::sync::Arc::clone(&shared)) {
                    Ok(handle) => handle,
                    Err(err) => {
                        warn!(error = %err, "重建输出后启动解码线程失败，回退到重新加载");
                        return SeekOutcome::Fallback;
                    }
                };
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| internal_error(format!("reinit task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                let committed = self
                    .inner
                    .call(move |player| player.commit_seeked(token, position, shared, handle))
                    .into_napi()?
                    .into_napi()?;
                if !committed {
                    info!("reinit 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                if !self
                    .inner
                    .call(move |player| player.is_load_token_current(token))
                    .into_napi()?
                {
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if is_load_superseded(&e) {
                            return Ok(());
                        }
                        if is_remote {
                            self.inner
                                .call(|player| player.emit_source_error())
                                .into_napi()?;
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Ok(())
                }
            }
        }
    }

    /// 设置封面缓存目录（在 load 前调用一次即可）
    #[napi]
    pub fn set_cover_cache_dir(&self, dir: String) -> Result<()> {
        self.inner
            .call(move |player| player.set_cover_cache_dir(dir))
            .into_napi()
    }

    /// 注册事件回调，Rust 侧会在状态变化、位置更新、播放结束时主动调用
    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let (emitter, event_pump) = create_event_pump(callback)?;

        *self.device_event_callback.write() = Some(Arc::clone(&emitter));
        self.inner
            .call(move |player| player.set_event_callback(emitter))
            .into_napi()?;
        *self.event_pump.lock() = Some(event_pump);
        Ok(())
    }

    /// 加载音频源，返回完整元信息（含封面路径和歌词）
    /// @param auto_play - 是否自动播放，false 时加载后立即暂停
    ///
    /// 异步三段式：
    /// 1. 主线程持锁瞬间（微秒级）：take 旧解码线程 handle + 拿参数（cover_dir / 归一化开关）
    /// 2. spawn_blocking 工作线程（**不持有 inner 引用**）：读取音源采样率、协商输出流并启动解码
    /// 3. 主线程持锁瞬间：提交输出流、构造 sink + attach + emit stateChanged
    /// 持锁阶段都是纯内存操作，主线程其它同步 NAPI 调用最多等几微秒，不会被 IO 卡住
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
    ) -> Result<JsMusicMetadata> {
        use crate::shared::Shared;

        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "加载音频源");

        let interrupt = crate::http_source::HttpInterrupt::new();
        let player_interrupt = interrupt.clone();
        let (
            old_threads,
            old_output,
            token,
            load_token,
            cover_dir,
            normalization_enabled,
            device_id,
        ) = self
            .inner
            .call(move |player| {
                let (old_threads, old_output, token) = player.take_for_async_load(player_interrupt);
                (
                    old_threads,
                    old_output,
                    token,
                    player.load_token_handle(),
                    player.cover_cache_dir().map(String::from),
                    player.is_normalization_enabled(),
                    player.selected_device_id().map(String::from),
                )
            })
            .into_napi()?;

        let source_for_decoder = source.clone();

        let result = tokio::task::spawn_blocking(move || {
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            drop(old_output);
            let prepared =
                decoder::prepare_decode(&source_for_decoder, cover_dir.as_deref(), interrupt)?;
            if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                return Err(anyhow::Error::new(
                    crate::error::AudioEngineError::LoadSuperseded,
                ));
            }
            let output = audio_output::AudioOutput::new(device_id.as_deref())?;
            let shared = Shared::new(output.sample_rate(), decoder::TARGET_CHANNELS);
            shared.set_normalization_enabled(normalization_enabled);
            let (metadata, decode_handle) =
                decoder::start_prepared_decode(prepared, Arc::clone(&shared))?;
            Ok::<_, anyhow::Error>((metadata, decode_handle, shared, output, device_id))
        })
        .await
        .map_err(|e| internal_error(format!("load task join error: {e}")))?;

        let (metadata, decode_handle, shared, output, output_device_id) = match result {
            Ok(result) => result,
            Err(error) => {
                let current = self
                    .inner
                    .call(move |player| {
                        let current = player.is_load_token_current(token);
                        if current {
                            player.clear_pending_load(token);
                        }
                        current
                    })
                    .into_napi()?;
                if !current {
                    return Err(load_superseded_error());
                }
                return Err(error).into_napi();
            }
        };

        let returned_meta = self
            .inner
            .call(move |player| {
                player.commit_loaded(
                    token,
                    &source,
                    auto_play,
                    crate::player::LoadedPlayback {
                        metadata,
                        decode_handle,
                        shared,
                        output,
                        output_device_id,
                    },
                )
            })
            .into_napi()?
            .into_napi()?;

        match returned_meta {
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(load_superseded_error()),
        }
    }

    /// 内部：将 AudioMetadata 转为 JS 结构
    fn meta_to_js(meta: crate::shared::AudioMetadata) -> JsMusicMetadata {
        JsMusicMetadata {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            comment: meta.comment,
            duration: meta.duration_secs,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u32,
            original_sample_rate: meta.original_sample_rate,
            bits_per_sample: meta.bits_per_sample,
            bit_rate: meta.bit_rate,
            codec: meta.codec,
            embedded_lyric: meta.embedded_lyric,
            external_lyrics: meta
                .external_lyrics
                .into_iter()
                .map(|l| JsExternalLyric {
                    format: l.format,
                    path: l.path,
                })
                .collect(),
            cover: meta.cover,
        }
    }

    /// 恢复播放。如果已停止或播放结束，自动从头重新加载
    #[napi]
    pub async fn play(&self) -> Result<()> {
        let revival_source = self
            .inner
            .call(InnerPlayer::play)
            .into_napi()?
            .into_napi()?;
        if let Some(source) = revival_source {
            let is_remote = source.starts_with("http://") || source.starts_with("https://");
            if let Err(e) = self.load(source, Some(true)).await {
                // 复活加载被更新的 load/stop 取代不是错误：已有更新的操作接管播放
                if is_load_superseded(&e) {
                    return Ok(());
                }
                // 远端源复活失败（多半 URL 过期）：发 sourceError 交 JS 重解析（命中本地缓存 / 拿新 URL）
                if is_remote {
                    self.inner
                        .call(|player| player.emit_source_error())
                        .into_napi()?;
                    return Ok(());
                }
                return Err(e);
            }
        }
        Ok(())
    }

    /// 暂停播放
    #[napi]
    pub fn pause(&self) -> Result<()> {
        self.inner.call(InnerPlayer::pause).into_napi()
    }

    /// 停止播放并释放资源
    #[napi]
    pub fn stop(&self) -> Result<()> {
        self.inner.call(InnerPlayer::stop).into_napi()
    }

    /// 跳转到指定播放位置（秒）
    ///
    /// 异步三段式：与 load 同样的设计原则
    /// 1. 主线程瞬时持锁：take 旧解码线程 + 拿归一化参数
    /// 2. 工作线程：join 旧线程 → ffmpeg seek → resume_decode 启动新解码线程
    /// 3. 主线程瞬时持锁：attach 新 sink + emit 状态
    /// seek 失败时 fallback 到完整 load
    #[napi]
    pub async fn seek(&self, position: f64) -> Result<()> {
        if !position.is_finite() || position < 0.0 {
            return Err(invalid_argument("播放位置必须是有限的非负数"));
        }
        use crate::shared::Shared;

        let take = self
            .inner
            .call(InnerPlayer::take_for_async_seek)
            .into_napi()?;
        // 无解码线程：空闲 / 已停止 / 正在异步加载（句柄被 load 取走）。
        // 此时 seek 无意义，且绝不能走回退重载——current_source 仍指向旧曲，
        // 重载会顶掉在途的新歌加载、复活旧曲
        let Some(take) = take else {
            return Ok(());
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source,
            was_playing,
            output_sample_rate,
            token,
        } = take;

        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            // 沿用实际输出流采样率，与复用的 DecoderData 重采样器目标一致
            let shared = Shared::new(output_sample_rate, decoder::TARGET_CHANNELS);
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            let handle = match decoder::resume_decode(decoder_data, Arc::clone(&shared)) {
                Ok(handle) => handle,
                Err(err) => {
                    warn!(error = %err, "seek 后启动解码线程失败，回退到重新加载");
                    return SeekOutcome::Fallback;
                }
            };
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| internal_error(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                let committed = self
                    .inner
                    .call(move |player| player.commit_seeked(token, position, shared, handle))
                    .into_napi()?
                    .into_napi()?;
                if !committed {
                    info!(position, "seek 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                // seek 期间已被新的 load/stop 取代时不再回退重载，避免复活旧源
                if !self
                    .inner
                    .call(move |player| player.is_load_token_current(token))
                    .into_napi()?
                {
                    info!(position, "seek 失败且已被取代，跳过回退重载");
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if is_load_superseded(&e) {
                            return Ok(());
                        }
                        // 远端源回退重开失败（多半 URL 过期）：发 sourceError 交 JS 重解析
                        if is_remote {
                            self.inner
                                .call(|player| player.emit_source_error())
                                .into_napi()?;
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Err(internal_error("seek 失败且无 current_source"))
                }
            }
        }
    }

    /// 设置音量（0.0 ~ 1.0）
    #[napi]
    pub fn set_volume(&self, volume: f64) -> Result<()> {
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err(invalid_argument("音量必须在 0 到 1 之间"));
        }
        self.inner
            .call(move |player| player.set_volume(volume as f32))
            .into_napi()
    }

    /// 获取当前音量（0.0 ~ 1.0）
    #[napi]
    pub fn get_volume(&self) -> Result<f64> {
        self.inner.call(|player| player.volume() as f64).into_napi()
    }

    /// 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用渐变
    #[napi]
    pub fn set_fade_duration(&self, duration_ms: f64) -> Result<()> {
        if !duration_ms.is_finite() || !(0.0..=60_000.0).contains(&duration_ms) {
            return Err(invalid_argument("渐变时长必须在 0 到 60000 毫秒之间"));
        }
        self.inner
            .call(move |player| player.set_fade_duration(duration_ms as u64))
            .into_napi()
    }

    /// 获取当前渐变时长（毫秒）
    #[napi]
    pub fn get_fade_duration(&self) -> Result<f64> {
        self.inner
            .call(|player| player.fade_duration() as f64)
            .into_napi()
    }

    /// 获取当前播放位置（秒）
    #[napi]
    pub fn get_position(&self) -> Result<f64> {
        self.inner.call(|player| player.position()).into_napi()
    }

    /// 获取总时长（秒）
    #[napi]
    pub fn get_duration(&self) -> Result<f64> {
        self.inner.call(|player| player.duration()).into_napi()
    }

    /// 获取当前播放状态快照
    #[napi]
    pub fn get_status(&self) -> Result<JsPlayerStatus> {
        self.inner
            .call(|player| JsPlayerStatus {
                state: state_to_str(player.state()).to_string(),
                position: player.position(),
                duration: player.duration(),
                volume: player.volume() as f64,
                is_finished: player.is_finished(),
            })
            .into_napi()
    }

    /// 获取低频诊断快照；不得在渲染帧循环中调用。
    #[napi]
    pub fn get_diagnostics(&self) -> Result<JsAudioDiagnostics> {
        let diagnostics = self.inner.call(|player| player.diagnostics()).into_napi()?;
        Ok(JsAudioDiagnostics {
            state: state_to_str(diagnostics.state).to_string(),
            source_sample_rate: diagnostics.source_sample_rate,
            output_sample_rate: diagnostics.output_sample_rate,
            output_channels: u32::from(diagnostics.output_channels),
            buffered_chunks: u32::try_from(diagnostics.buffered_chunks).unwrap_or(u32::MAX),
            submitted_samples: diagnostics.submitted_samples as f64,
            underrun_samples: diagnostics.underrun_samples as f64,
            xrun_count: diagnostics.xrun_count as f64,
            realtime_denied_count: diagnostics.realtime_denied_count as f64,
            callback_allocation_count: diagnostics.callback_allocation_count as f64,
            callback_max_duration_us: diagnostics.callback_max_duration_us as f64,
            ring_capacity_frames: if diagnostics.output_channels == 0 {
                0.0
            } else {
                diagnostics.ring_capacity_samples as f64 / f64::from(diagnostics.output_channels)
            },
            ring_fill_frames: if diagnostics.output_channels == 0 {
                0.0
            } else {
                diagnostics.ring_fill_samples as f64 / f64::from(diagnostics.output_channels)
            },
            rebuild_attempts: self.rebuild_attempts.load(Ordering::Relaxed) as f64,
            rebuild_failures: self.rebuild_failures.load(Ordering::Relaxed) as f64,
            clock_quality: match diagnostics.clock_quality {
                audio_output::ClockQuality::Hardware => "hardware",
                audio_output::ClockQuality::Estimated => "estimated",
            }
            .to_string(),
            selected_device_id: diagnostics.selected_device_id,
            active_device_id: diagnostics.active_device_id,
        })
    }

    /// 启用/禁用 FFT 频谱推送（前端需要显示频谱时启用，不显示时禁用以节省性能）
    #[napi]
    pub fn set_fft_enabled(&self, enabled: bool) -> Result<()> {
        self.inner
            .call(move |player| player.set_fft_enabled(enabled))
            .into_napi()
    }

    /// 获取 FFT 推送开关状态
    #[napi]
    pub fn get_fft_enabled(&self) -> Result<bool> {
        self.inner.call(|player| player.fft_enabled()).into_napi()
    }

    /// 启用/禁用音量归一化（实时响度均衡）
    #[napi]
    pub fn set_normalization_enabled(&self, enabled: bool) -> Result<()> {
        self.inner
            .call(move |player| player.set_normalization_enabled(enabled))
            .into_napi()
    }

    /// 获取音量归一化开关状态
    #[napi]
    pub fn get_normalization_enabled(&self) -> Result<bool> {
        self.inner
            .call(|player| player.normalization_enabled())
            .into_napi()
    }

    /// 启用/禁用 10 频段均衡器
    #[napi]
    pub fn set_equalizer_enabled(&self, enabled: bool) -> Result<()> {
        self.inner
            .call(move |player| player.set_equalizer_enabled(enabled))
            .into_napi()
    }

    /// 获取均衡器开关状态
    #[napi]
    pub fn get_equalizer_enabled(&self) -> Result<bool> {
        self.inner
            .call(|player| player.equalizer_enabled())
            .into_napi()
    }

    /// 更新均衡器各频段增益（dB），长度必须为 10，范围 [-15, 15]
    #[napi]
    pub fn set_equalizer_bands(&self, gains_db: Vec<f64>) -> Result<()> {
        if gains_db.len() != EQ_BAND_COUNT
            || gains_db
                .iter()
                .any(|value| !value.is_finite() || !(-15.0..=15.0).contains(value))
        {
            return Err(invalid_argument(
                "均衡器增益必须是 10 个 [-15, 15] 的有限数",
            ));
        }
        let bands: Vec<f32> = gains_db.into_iter().map(|v| v as f32).collect();
        self.inner
            .call(move |player| player.set_equalizer_bands(&bands))
            .into_napi()
    }

    /// 获取均衡器各频段当前增益（dB）
    #[napi]
    pub fn get_equalizer_bands(&self) -> Result<Vec<f64>> {
        self.inner
            .call(|player| {
                player
                    .equalizer_bands()
                    .iter()
                    .map(|value| f64::from(*value))
                    .collect()
            })
            .into_napi()
    }

    /// 设置前级增益（dB），范围 [-12, 12]
    #[napi]
    pub fn set_preamp_gain(&self, preamp_db: f64) -> Result<()> {
        if !preamp_db.is_finite() || !(-12.0..=12.0).contains(&preamp_db) {
            return Err(invalid_argument("前级增益必须在 -12 到 12 dB 之间"));
        }
        self.inner
            .call(move |player| player.set_preamp_gain(preamp_db as f32))
            .into_napi()
    }

    /// 获取前级增益（dB）
    #[napi]
    pub fn get_preamp_gain(&self) -> Result<f64> {
        self.inner
            .call(|player| f64::from(player.preamp_gain()))
            .into_napi()
    }

    /// 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
    #[napi]
    pub fn get_fft_data(&self) -> Result<JsFftData> {
        let (ldata, rdata) = self.inner.call(|player| player.fft_data()).into_napi()?;
        let ldata = ldata.into_iter().map(|v| v as f64).collect();
        let rdata = rdata.into_iter().map(|v| v as f64).collect();
        Ok(JsFftData { ldata, rdata })
    }

    /// 返回 load 时缓存的原始封面数据（用于 SMTC / 全屏播放器）。
    /// 封面在 load 阶段从已打开的 FFmpeg 上下文一次性提取，不再重复打开文件。
    #[napi]
    pub fn get_cover_raw(&self) -> Result<Option<napi::bindgen_prelude::Buffer>> {
        self.inner
            .call(|player| player.cover_raw().map(|data| data.to_vec().into()))
            .into_napi()
    }

    /// 获取所有音频输出设备列表
    #[napi]
    pub fn get_output_devices(&self) -> Vec<JsAudioDevice> {
        audio_output::list_output_devices()
            .into_iter()
            .map(|(id, name, host, is_default)| JsAudioDevice {
                id,
                name,
                host,
                is_default,
            })
            .collect()
    }

    /// 获取系统默认输出设备名称
    #[napi]
    pub fn get_default_device_name(&self) -> Option<String> {
        audio_output::default_device_name()
    }

    /// 切换输出设备（传 None/undefined 使用系统默认）
    #[napi]
    pub async fn set_output_device(&self, device_id: Option<String>) -> Result<()> {
        info!(device = ?device_id, "切换输出设备");
        let requested_device_id = device_id.clone();
        self.inner
            .call(move |player| player.set_output_device(requested_device_id))
            .into_napi()?;
        let result = self.reinit_output().await;
        if result.is_err() {
            self.inner
                .call(move |player| {
                    if player.selected_device_id() == device_id.as_deref() {
                        let active = player.active_device_id().map(String::from);
                        player.set_output_device(active);
                    }
                })
                .into_napi()?;
        }
        result
    }

    /// 获取当前选择的输出设备 ID（None = 系统默认）
    #[napi]
    pub fn get_selected_device_id(&self) -> Result<Option<String>> {
        self.inner
            .call(|player| player.selected_device_id().map(String::from))
            .into_napi()
    }

    /// 设置播放速度（自动 clamp 到 [0.5, 2.0]）
    #[napi]
    pub fn set_speed(&self, speed: f64) -> Result<()> {
        if !speed.is_finite() || !(0.5..=2.0).contains(&speed) {
            return Err(invalid_argument("播放速度必须在 0.5 到 2 之间"));
        }
        self.inner
            .call(move |player| player.set_speed(speed as f32))
            .into_napi()
    }

    /// 设置音调偏移（半音，自动 clamp 到 [-12, 12]）
    #[napi]
    pub fn set_pitch(&self, semitones: i32) -> Result<()> {
        self.inner
            .call(move |player| player.set_pitch(semitones.clamp(-12, 12) as i8))
            .into_napi()
    }

    /// 设置"音调同步"开关（true = 变速保音调）
    #[napi]
    pub fn set_pitch_sync(&self, sync: bool) -> Result<()> {
        self.inner
            .call(move |player| player.set_pitch_sync(sync))
            .into_napi()
    }

    /// 获取当前播放速度
    #[napi]
    pub fn get_speed(&self) -> Result<f64> {
        self.inner
            .call(|player| f64::from(player.speed()))
            .into_napi()
    }

    /// 获取当前音调（半音）
    #[napi]
    pub fn get_pitch(&self) -> Result<i32> {
        self.inner
            .call(|player| i32::from(player.pitch()))
            .into_napi()
    }

    /// 获取"音调同步"开关状态
    #[napi]
    pub fn get_pitch_sync(&self) -> Result<bool> {
        self.inner.call(|player| player.pitch_sync()).into_napi()
    }
}

/// 已有文件记录，用于增量扫描比对
#[napi(object)]
pub struct FileRecord {
    pub path: String,
    pub mtime: f64,
    pub size: f64,
}

/// 扫描到的曲目信息
#[napi(object)]
pub struct JsScannedTrack {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 音轨编号
    pub track: Option<u16>,
    /// 时长（秒）
    pub duration: f64,
    pub codec: String,
    pub sample_rate: u32,
    pub bit_rate: i64,
    pub channels: u32,
    pub bits_per_sample: u32,
    /// 封面缓存路径
    pub cover: Option<String>,
    /// 文件大小（字节）
    pub file_size: f64,
    /// 修改时间（Unix ms）
    pub mtime: f64,
    /// 创建时间（Unix ms）
    pub ctime: f64,
}

impl From<scanner::ScannedTrack> for JsScannedTrack {
    fn from(track: scanner::ScannedTrack) -> Self {
        Self {
            path: track.path,
            title: track.title,
            artist: track.artist,
            album: track.album,
            track: track.track,
            duration: track.duration,
            codec: track.codec,
            sample_rate: track.sample_rate,
            bit_rate: track.bit_rate,
            channels: track.channels,
            bits_per_sample: track.bits_per_sample,
            cover: track.cover,
            file_size: track.file_size as f64,
            mtime: track.mtime as f64,
            ctime: track.ctime as f64,
        }
    }
}

/// 扫描事件回调数据
#[napi(object)]
#[derive(Default)]
pub struct JsScanEvent {
    /// "progress" | "done"
    pub event_type: String,
    /// 已扫描文件数
    pub scanned: u32,
    /// 总文件数
    pub total: u32,
    /// 当前正在处理的文件名
    pub current: Option<String>,
    /// 本批次扫描结果
    pub tracks: Option<Vec<JsScannedTrack>>,
    /// 已删除的文件路径列表（仅 done 事件）
    pub removed_paths: Option<Vec<String>>,
    /// 遍历时收集到的 CUE 文件路径（仅 done 事件）
    pub cue_files: Option<Vec<String>>,
    /// 不可达的扫描目录
    pub unavailable_dirs: Option<Vec<String>>,
    /// done 是否完整遍历；false 时数据库不得执行删除
    pub complete: Option<bool>,
    /// complete | partial | cancelled
    pub status: Option<String>,
    /// 遍历、stat 或元数据解析失败数
    pub error_count: Option<u32>,
}

/// 批量扫描目录，通过回调推送进度和结果
///
/// 在后台线程中执行，不阻塞 Node.js 事件循环。
/// 每处理约 20 个文件回调一次 progress 事件，完成后回调 done 事件。
#[napi(
    ts_args_type = "dirs: Array<string>, callback: (event: JsScanEvent) => void, coverCacheDir?: string | undefined | null, incrementalData?: Array<FileRecord> | undefined | null"
)]
pub fn scan_dirs(
    dirs: Vec<String>,
    callback: Function<JsScanEvent, ()>,
    cover_cache_dir: Option<String>,
    incremental_data: Option<Vec<FileRecord>>,
) -> Result<()> {
    let tsfn = callback
        .build_threadsafe_function()
        .max_queue_size::<4>()
        .build()?;

    // 将 JS FileRecord 转为内部类型
    let records: Option<Vec<scanner::FileRecord>> = incremental_data.map(|data| {
        data.into_iter()
            .map(|r| scanner::FileRecord {
                path: r.path,
                mtime: r.mtime as u64,
                size: r.size as u64,
            })
            .collect()
    });

    // 创建取消标志并保存到全局，供 cancel_scan 使用
    let cancel = Arc::new(AtomicBool::new(false));
    *SCAN_CANCEL.lock() = Some(Arc::clone(&cancel));

    thread::spawn(move || {
        let emit = |event: scanner::ScanEvent| {
            let js_event = match event {
                scanner::ScanEvent::Progress {
                    scanned,
                    total,
                    current,
                    tracks,
                } => JsScanEvent {
                    event_type: "progress".into(),
                    scanned,
                    total,
                    current,
                    tracks: Some(tracks.into_iter().map(JsScannedTrack::from).collect()),
                    ..Default::default()
                },
                scanner::ScanEvent::Done {
                    scanned,
                    total,
                    removed_paths,
                    cue_files,
                    unavailable_dirs,
                    complete,
                    status,
                    error_count,
                } => JsScanEvent {
                    event_type: "done".into(),
                    scanned,
                    total,
                    removed_paths: Some(removed_paths),
                    cue_files: Some(cue_files),
                    unavailable_dirs: Some(unavailable_dirs),
                    complete: Some(complete),
                    status: Some(status.to_string()),
                    error_count: Some(error_count),
                    ..Default::default()
                },
            };
            // 扫描结果承载数据库写入，后台扫描线程允许等待 JS 消费，不能丢批次。
            tsfn.call(js_event, ThreadsafeFunctionCallMode::Blocking);
        };

        scanner::scan_directories(
            &dirs,
            cover_cache_dir.as_deref(),
            records.as_deref(),
            &cancel,
            &emit,
        );

        // 扫描结束后清除全局取消标志
        *SCAN_CANCEL.lock() = None;
    });

    Ok(())
}

/// 取消正在进行的扫描任务
#[napi]
pub fn cancel_scan() {
    if let Some(cancel) = SCAN_CANCEL.lock().as_ref() {
        cancel.store(true, Ordering::Release);
        info!("已发送扫描取消信号");
    }
}

/// 可编辑标签（读取结果）
#[napi(object)]
pub struct JsTrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    /// 内嵌歌词纯文本
    pub lyrics: Option<String>,
    /// 是否有内嵌封面
    pub has_cover: bool,
}

/// 单文件标签写入请求。字段为 undefined/null 表示不修改；
/// 文本传空串、数字传 0 表示清除该标签项
#[napi(object)]
pub struct JsTagWriteRequest {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub lyrics: Option<String>,
    /// 新封面图片数据（jpg/png），undefined 表示保留现有封面
    pub cover: Option<Buffer>,
}

/// 单文件写入结果
#[napi(object)]
pub struct JsTagWriteResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
    /// 写入成功后重新探测的元数据
    pub track: Option<JsScannedTrack>,
}

/// 把任意图片字节缩成 JPEG 缩略图（用于选图预览）
/// 渲染层只拿小缩略图，避免整图解码成位图占用大量内存
#[napi]
pub async fn make_image_thumbnail(data: Buffer, max_size: u32) -> Result<Buffer> {
    let bytes = data.to_vec();
    let thumb =
        tokio::task::spawn_blocking(move || metadata::make_thumbnail_jpeg(&bytes, max_size))
            .await
            .map_err(|e| internal_error(format!("缩略图任务失败: {e}")))?
            .into_napi()?;
    Ok(thumb.into())
}

/// 读取文件的可编辑标签（异步，阻塞 IO 在 tokio 阻塞线程执行）
#[napi]
pub async fn read_track_tags(path: String) -> Result<JsTrackTags> {
    let tags = tokio::task::spawn_blocking(move || tag_editor::read_tags(&path))
        .await
        .map_err(|e| internal_error(format!("读取标签任务失败: {e}")))?
        .into_napi()?;
    Ok(JsTrackTags {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        year: tags.year,
        genre: tags.genre,
        track_number: tags.track_number,
        disc_number: tags.disc_number,
        lyrics: tags.lyrics,
        has_cover: tags.has_cover,
    })
}

/// 写入后重新探测单文件元数据，补全文件时间与大小
fn probe_after_write(path: &str, cover_cache_dir: Option<&str>) -> Option<JsScannedTrack> {
    let mut track = scanner::probe_fast(path, cover_cache_dir)?;
    if let Some((mtime, ctime, size)) = scanner::file_stat(std::path::Path::new(path)) {
        track.mtime = mtime;
        track.ctime = ctime;
        track.file_size = size;
    }
    Some(JsScannedTrack::from(track))
}

/// 批量写入标签（异步），逐项返回结果，单项失败不中断整批。
/// 替换封面时会作废旧缩略图缓存，写后按扫描同等规则重新生成
#[napi]
pub async fn write_track_tags(
    requests: Vec<JsTagWriteRequest>,
    cover_cache_dir: Option<String>,
) -> Result<Vec<JsTagWriteResult>> {
    // Buffer 数据在进入阻塞线程前拷出
    let internal: Vec<tag_editor::TagWriteRequest> = requests
        .into_iter()
        .map(|request| tag_editor::TagWriteRequest {
            path: request.path,
            title: request.title,
            artist: request.artist,
            album: request.album,
            album_artist: request.album_artist,
            year: request.year,
            genre: request.genre,
            track_number: request.track_number,
            disc_number: request.disc_number,
            lyrics: request.lyrics,
            cover: request.cover.map(|buffer| buffer.to_vec()),
        })
        .collect();

    tokio::task::spawn_blocking(move || {
        internal
            .iter()
            .map(|request| {
                if let Err(error) = tag_editor::write_tags(request) {
                    warn!(path = %request.path, "标签写入失败: {error:#}");
                    return JsTagWriteResult {
                        path: request.path.clone(),
                        success: false,
                        error: Some(format!("{error:#}")),
                        track: None,
                    };
                }
                // 封面已替换：删除旧缩略图，probe 时按新封面重新生成
                if request.cover.is_some()
                    && let Some(ref dir) = cover_cache_dir
                {
                    let _ = std::fs::remove_file(metadata::cover_thumb_path(&request.path, dir));
                }
                info!(path = %request.path, "标签写入成功");
                JsTagWriteResult {
                    path: request.path.clone(),
                    success: true,
                    error: None,
                    track: probe_after_write(&request.path, cover_cache_dir.as_deref()),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| internal_error(format!("标签写入任务失败: {e}")))
}

/// 归一化键名：转小写并过滤非英文字母与数字（去除空格、下划线、连字符等标点）
pub fn normalize_tag_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// 判断一个归一化后的键名是否为可能的歌词字段
pub fn is_lyric_field_key(norm_key: &str) -> bool {
    let prefixes = [
        "unsyncedlyrics",
        "syncedlyrics",
        "lyrics",
        "uslt",
        "sylt",
        "lyric",
    ];

    for prefix in &prefixes {
        if norm_key.starts_with(prefix) {
            return true;
        }
    }

    false
}

/// 获取歌词字段优先级：
/// - 2 (高优先级)：用于同步歌词（如 syncedlyrics, sylt, lyrics）
/// - 1 (低优先级)：用于非同步歌词（如 unsyncedlyrics, uslt, lyric）
/// - 0 (无效)：非歌词字段
pub fn get_lyric_priority(norm_key: &str) -> u8 {
    if !is_lyric_field_key(norm_key) {
        return 0;
    }
    if norm_key.starts_with("lyrics")
        || norm_key.starts_with("syncedlyrics")
        || norm_key.starts_with("sylt")
    {
        return 2;
    }
    if norm_key.starts_with("unsyncedlyrics")
        || norm_key.starts_with("uslt")
        || norm_key.starts_with("lyric")
    {
        return 1;
    }
    1
}
