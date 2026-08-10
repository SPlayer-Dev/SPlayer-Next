use std::sync::Arc;
use std::thread::JoinHandle;

use ffmpeg_audio::HttpCancelHandle;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::player::{self, InnerPlayer, PlayerEvent, PlayerState, SeekTake};
use crate::{audio_output, decoder, device_watcher};

use super::IntoNapiResult;

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

/// load 被更新的 load/stop 取代时的错误文案
/// 主进程 IPC 按此文案识别并映射为 LOAD_SUPERSEDED（正常竞态，前端静默），改动需同步
const LOAD_SUPERSEDED_REASON: &str = "load 已被更新的 load 取代";

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
    pub name: String,
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
    /// 事件类型："stateChanged" | "ended" | "sourceError" | "position" | "fftData" | "outputStalled"
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
/// 音频播放器，通过 napi-rs 暴露给 Node.js
#[napi]
pub struct AudioPlayer {
    inner: Arc<Mutex<InnerPlayer>>,
    device_watcher: Mutex<Option<device_watcher::DeviceWatcher>>,
}

#[napi]
impl AudioPlayer {
    /// 创建新的播放器实例
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().into_napi()?;
        info!("AudioPlayer 实例已创建");
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
            device_watcher: Mutex::new(None),
        })
    }

    /// 重新初始化音频输出设备（系统休眠唤醒后调用）
    #[napi]
    pub async fn reinit_output(&self) -> Result<()> {
        info!("重新初始化音频输出设备");

        let (take, position, was_playing, current_source) = {
            let mut player = self.inner.lock();
            let position = player.position();
            let was_playing = player.state() == PlayerState::Playing;
            let current_source = player.current_source();

            let take = player.take_for_async_seek();

            if let Err(e) = player.recreate_output_device() {
                warn!("重建输出设备失败: {}", e);
            }

            let take = take.map(|mut t| {
                t.output_sample_rate = player.output_sample_rate();
                t
            });

            (take, position, was_playing, current_source)
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
            equalizer,
            tempo,
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
            equalizer.lock().set_sample_rate(output_sample_rate);
            equalizer.lock().reset_state();
            tempo.lock().set_sample_rate(output_sample_rate);
            tempo.lock().reset();
            let handle = match crate::decoder::resume_decode(
                decoder_data,
                std::sync::Arc::clone(&shared),
                equalizer,
                tempo,
            ) {
                Ok(handle) => handle,
                Err(err) => {
                    warn!(error = %err, "重建输出后启动解码线程失败，回退到重新加载");
                    return SeekOutcome::Fallback;
                }
            };
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| Error::from_reason(format!("reinit task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                let mut player = self.inner.lock();
                let committed = player
                    .commit_seeked(token, position, shared, handle)
                    .into_napi()?;
                if !committed {
                    info!("reinit 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                if !self.inner.lock().is_load_token_current(token) {
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if e.reason == LOAD_SUPERSEDED_REASON {
                            return Ok(());
                        }
                        if is_remote {
                            self.inner.lock().emit_source_error();
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
    pub fn set_cover_cache_dir(&self, dir: String) {
        self.inner.lock().set_cover_cache_dir(dir);
    }

    /// 注册事件回调，Rust 侧会在状态变化、位置更新、播放结束时主动调用
    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;

        // 用闭包包裹 tsfn，在内部做 PlayerEvent → JsPlayerEvent 转换
        let emitter: player::EventEmitter = Arc::new(move |event: PlayerEvent| {
            let js_event = match event {
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
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".into(),
                    position: Some(position),
                    duration: Some(duration),
                    ..Default::default()
                },
                PlayerEvent::FftData { ldata, rdata } => JsPlayerEvent {
                    event_type: "fftData".into(),
                    fft_data: Some(JsFftData {
                        ldata: ldata.into_iter().map(|v| v as f64).collect(),
                        rdata: rdata.into_iter().map(|v| v as f64).collect(),
                    }),
                    ..Default::default()
                },
                PlayerEvent::OutputStalled => JsPlayerEvent {
                    event_type: "outputStalled".into(),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        self.inner.lock().set_event_callback(emitter);
        Ok(())
    }

    /// 当前平台是否支持原生音频设备监听
    #[napi]
    pub fn supports_device_watcher(&self) -> bool {
        device_watcher::is_supported()
    }

    /// 注册系统音频设备变化回调，不支持的平台由主进程轮询
    #[napi(ts_args_type = "callback: () => void")]
    pub fn on_device_change(&self, callback: Function<(), ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;
        let watcher = device_watcher::DeviceWatcher::new(Box::new(move || {
            tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .into_napi()?;
        *self.device_watcher.lock() = Some(watcher);
        info!("原生音频设备监听已启动");
        Ok(())
    }

    /// 停止系统音频设备变化监听
    #[napi]
    pub fn stop_device_watcher(&self) {
        if let Some(mut watcher) = self.device_watcher.lock().take() {
            watcher.stop();
            info!("原生音频设备监听已停止");
        }
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

        let handle = HttpCancelHandle::new();
        let (
            old_threads,
            old_output,
            token,
            load_token,
            cover_dir,
            normalization_enabled,
            device_name,
            equalizer,
            tempo,
        ) = {
            let mut player = self.inner.lock();
            let (old_threads, old_output, token) = player.take_for_async_load(handle.clone());
            (
                old_threads,
                old_output,
                token,
                player.load_token_handle(),
                player.cover_cache_dir().map(String::from),
                player.is_normalization_enabled(),
                player.selected_device_name().map(String::from),
                player.equalizer_handle(),
                player.tempo_handle(),
            )
        };

        let source_for_decoder = source.clone();

        let result = tokio::task::spawn_blocking(move || {
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            drop(old_output);
            let prepared =
                decoder::prepare_decode(&source_for_decoder, cover_dir.as_deref(), handle)?;
            if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                anyhow::bail!(LOAD_SUPERSEDED_REASON);
            }
            let output = audio_output::AudioOutput::new(device_name.as_deref())?;
            let shared = Shared::new(output.sample_rate(), decoder::TARGET_CHANNELS);
            shared.set_normalization_enabled(normalization_enabled);
            equalizer.lock().set_sample_rate(output.sample_rate());
            equalizer.lock().reset_state();
            tempo.lock().set_sample_rate(output.sample_rate());
            tempo.lock().reset();
            let (metadata, decode_handle, cancel) =
                decoder::start_prepared_decode(prepared, Arc::clone(&shared), equalizer, tempo)?;
            Ok::<_, anyhow::Error>((metadata, decode_handle, shared, output, cancel))
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?;

        let (metadata, decode_handle, shared, output, cancel) = match result {
            Ok(result) => result,
            Err(error) => {
                let mut player = self.inner.lock();
                if !player.is_load_token_current(token) {
                    return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                }
                player.clear_pending_load(token);
                return Err(error).into_napi();
            }
        };

        let returned_meta = {
            let mut player = self.inner.lock();
            player
                .commit_loaded(
                    token,
                    &source,
                    auto_play,
                    crate::player::LoadedPlayback {
                        metadata,
                        decode_handle,
                        shared,
                        output,
                        cancel,
                    },
                )
                .into_napi()?
        };

        match returned_meta {
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
        }
    }

    /// 内部：将 AudioMetadata 转为 JS 结构
    fn meta_to_js(meta: crate::metadata::AudioMetadata) -> JsMusicMetadata {
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
        let revival_source = self.inner.lock().play().into_napi()?;
        if let Some(source) = revival_source {
            let is_remote = source.starts_with("http://") || source.starts_with("https://");
            if let Err(e) = self.load(source, Some(true)).await {
                // 复活加载被更新的 load/stop 取代不是错误：已有更新的操作接管播放
                if e.reason == LOAD_SUPERSEDED_REASON {
                    return Ok(());
                }
                // 远端源复活失败（多半 URL 过期）：发 sourceError 交 JS 重解析（命中本地缓存 / 拿新 URL）
                if is_remote {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
        }
        Ok(())
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
    ///
    /// 异步三段式：与 load 同样的设计原则
    /// 1. 主线程瞬时持锁：take 旧解码线程 + 拿归一化参数
    /// 2. 工作线程：join 旧线程 → ffmpeg seek → resume_decode 启动新解码线程
    /// 3. 主线程瞬时持锁：attach 新 sink + emit 状态
    /// seek 失败时 fallback 到完整 load
    #[napi]
    pub async fn seek(&self, position: f64) -> Result<()> {
        use crate::shared::Shared;

        let take = {
            let mut player = self.inner.lock();
            player.take_for_async_seek()
        };
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
            equalizer,
            tempo,
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
            equalizer.lock().set_sample_rate(output_sample_rate);
            equalizer.lock().reset_state();
            tempo.lock().set_sample_rate(output_sample_rate);
            tempo.lock().reset();
            let handle =
                match decoder::resume_decode(decoder_data, Arc::clone(&shared), equalizer, tempo) {
                    Ok(handle) => handle,
                    Err(err) => {
                        warn!(error = %err, "seek 后启动解码线程失败，回退到重新加载");
                        return SeekOutcome::Fallback;
                    }
                };
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| Error::from_reason(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                let mut player = self.inner.lock();
                let committed = player
                    .commit_seeked(token, position, shared, handle)
                    .into_napi()?;
                if !committed {
                    info!(position, "seek 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                // seek 期间已被新的 load/stop 取代时不再回退重载，避免复活旧源
                if !self.inner.lock().is_load_token_current(token) {
                    info!(position, "seek 失败且已被取代，跳过回退重载");
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if e.reason == LOAD_SUPERSEDED_REASON {
                            return Ok(());
                        }
                        // 远端源回退重开失败（多半 URL 过期）：发 sourceError 交 JS 重解析
                        if is_remote {
                            self.inner.lock().emit_source_error();
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Err(Error::from_reason("seek 失败且无 current_source"))
                }
            }
        }
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
            state: state_to_str(player.state()).to_string(),
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
        }
    }

    /// 启用/禁用 FFT 频谱推送（前端需要显示频谱时启用，不显示时禁用以节省性能）
    #[napi]
    pub fn set_fft_enabled(&self, enabled: bool) {
        self.inner.lock().set_fft_enabled(enabled);
    }

    /// 获取 FFT 推送开关状态
    #[napi]
    pub fn get_fft_enabled(&self) -> bool {
        self.inner.lock().fft_enabled()
    }

    /// 启用/禁用音量归一化（实时响度均衡）
    #[napi]
    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.inner.lock().set_normalization_enabled(enabled);
    }

    /// 获取音量归一化开关状态
    #[napi]
    pub fn get_normalization_enabled(&self) -> bool {
        self.inner.lock().normalization_enabled()
    }

    /// 启用/禁用 10 频段均衡器
    #[napi]
    pub fn set_equalizer_enabled(&self, enabled: bool) {
        self.inner.lock().set_equalizer_enabled(enabled);
    }

    /// 获取均衡器开关状态
    #[napi]
    pub fn get_equalizer_enabled(&self) -> bool {
        self.inner.lock().equalizer_enabled()
    }

    /// 更新均衡器各频段增益（dB），长度必须为 10，范围 [-15, 15]
    #[napi]
    pub fn set_equalizer_bands(&self, gains_db: Vec<f64>) {
        let bands: Vec<f32> = gains_db.into_iter().map(|v| v as f32).collect();
        self.inner.lock().set_equalizer_bands(&bands);
    }

    /// 获取均衡器各频段当前增益（dB）
    #[napi]
    pub fn get_equalizer_bands(&self) -> Vec<f64> {
        self.inner
            .lock()
            .equalizer_bands()
            .iter()
            .map(|v| *v as f64)
            .collect()
    }

    /// 设置前级增益（dB），范围 [-12, 12]
    #[napi]
    pub fn set_preamp_gain(&self, preamp_db: f64) {
        self.inner.lock().set_preamp_gain(preamp_db as f32);
    }

    /// 获取前级增益（dB）
    #[napi]
    pub fn get_preamp_gain(&self) -> f64 {
        self.inner.lock().preamp_gain() as f64
    }

    /// 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
    #[napi]
    pub fn get_fft_data(&self) -> JsFftData {
        let (ldata, rdata) = self.inner.lock().fft_data();
        let ldata = ldata.into_iter().map(|v| v as f64).collect();
        let rdata = rdata.into_iter().map(|v| v as f64).collect();
        JsFftData { ldata, rdata }
    }

    /// 返回 load 时缓存的原始封面数据（用于 SMTC / 全屏播放器）。
    /// 封面在 load 阶段从已打开的 FFmpeg 上下文一次性提取，不再重复打开文件。
    #[napi]
    pub fn get_cover_raw(&self) -> Option<napi::bindgen_prelude::Buffer> {
        let player = self.inner.lock();
        let data = player.cover_raw()?;
        Some(data.to_vec().into())
    }

    /// 获取所有音频输出设备列表
    #[napi]
    pub fn get_output_devices(&self) -> Vec<JsAudioDevice> {
        audio_output::list_output_devices()
            .into_iter()
            .map(|(name, is_default)| JsAudioDevice { name, is_default })
            .collect()
    }

    /// 获取系统默认输出设备名称
    #[napi]
    pub fn get_default_device_name(&self) -> Option<String> {
        audio_output::default_device_name()
    }

    /// 切换输出设备（传 None/undefined 使用系统默认）
    #[napi]
    pub async fn set_output_device(&self, device_name: Option<String>) -> Result<()> {
        info!(device = ?device_name, "切换输出设备");
        self.inner.lock().set_output_device(device_name);
        self.reinit_output().await
    }

    /// 获取当前选择的输出设备名称（None = 系统默认）
    #[napi]
    pub fn get_selected_device_name(&self) -> Option<String> {
        self.inner.lock().selected_device_name().map(String::from)
    }

    /// 设置播放速度（自动 clamp 到 [0.5, 2.0]）
    #[napi]
    pub fn set_speed(&self, speed: f64) {
        self.inner.lock().set_speed(speed as f32);
    }

    /// 设置音调偏移（半音，自动 clamp 到 [-12, 12]）
    #[napi]
    pub fn set_pitch(&self, semitones: i32) {
        self.inner.lock().set_pitch(semitones.clamp(-12, 12) as i8);
    }

    /// 设置"音调同步"开关（true = 变速保音调）
    #[napi]
    pub fn set_pitch_sync(&self, sync: bool) {
        self.inner.lock().set_pitch_sync(sync);
    }

    /// 获取当前播放速度
    #[napi]
    pub fn get_speed(&self) -> f64 {
        self.inner.lock().speed() as f64
    }

    /// 获取当前音调（半音）
    #[napi]
    pub fn get_pitch(&self) -> i32 {
        self.inner.lock().pitch() as i32
    }

    /// 获取"音调同步"开关状态
    #[napi]
    pub fn get_pitch_sync(&self) -> bool {
        self.inner.lock().pitch_sync()
    }
}
