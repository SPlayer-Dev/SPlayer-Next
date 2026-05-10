//! FFmpeg 音频解码 + rodio 播放 + FFT 频谱分析。
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

mod decoder;
mod equalizer;
mod fft;
mod logger;
mod loudness;
mod metadata;
mod player;
mod scanner;
mod shared;
mod source;
mod tempo;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::info;

use player::{InnerPlayer, PlayerEvent, PlayerState, SeekTake};

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

/// anyhow::Error → napi::Error 统一转换
trait IntoNapiResult<T> {
    fn into_napi(self) -> napi::Result<T>;
}

impl<T> IntoNapiResult<T> for anyhow::Result<T> {
    fn into_napi(self) -> napi::Result<T> {
        self.map_err(|e| Error::from_reason(format!("{e:#}")))
    }
}

/// 初始化原生日志系统（主进程启动时调用一次）
#[napi]
pub fn init_logger(log_dir: String, is_dev: bool) {
    logger::init_logger(&log_dir, is_dev);
    // 静默 FFmpeg 内部日志，避免 seek 时的 invalid sync code 等无害警告输出到控制台
    // 只保留致命错误，过滤 seek 时的 invalid sync code 等无害警告
    ffmpeg_next::log::set_level(ffmpeg_next::log::Level::Fatal);
    info!(log_dir, is_dev, "audio-engine 日志系统已初始化");
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
    /// 设备名称
    pub name: String,
    /// 是否为系统默认设备
    pub is_default: bool,
}

/// 播放器事件，推送给 JS 侧
#[napi(object)]
#[derive(Default)]
pub struct JsPlayerEvent {
    /// 事件类型："stateChanged" | "ended" | "position" | "fftData" | "outputStalled"
    #[napi(js_name = "type")]
    pub event_type: String,
    /// 状态（仅 stateChanged 时有值）
    pub state: Option<String>,
    /// 位置（秒，仅 position 时有值）
    pub position: Option<f64>,
    /// 时长（秒，仅 position 时有值）
    pub duration: Option<f64>,
    /// FFT 频谱数据（仅 fftData 时有值，128 个频段，值域 0.0 ~ 1.0）
    pub fft_data: Option<Vec<f64>>,
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
        })
    }

    /// 重新初始化音频输出设备（系统休眠唤醒后调用）
    #[napi]
    pub fn reinit_output(&self) -> Result<()> {
        info!("重新初始化音频输出设备");
        self.inner.lock().reinit_output().into_napi()
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
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".into(),
                    position: Some(position),
                    duration: Some(duration),
                    ..Default::default()
                },
                PlayerEvent::FftData { data } => JsPlayerEvent {
                    event_type: "fftData".into(),
                    fft_data: Some(data.into_iter().map(|v| v as f64).collect()),
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

    /// 加载音频源，返回完整元信息（含封面路径和歌词）
    /// @param auto_play - 是否自动播放，false 时加载后立即暂停
    ///
    /// 异步三段式：
    /// 1. 主线程持锁瞬间（微秒级）：take 旧解码线程 handle + 拿参数（cover_dir / 归一化开关）
    /// 2. spawn_blocking 工作线程（**不持有 inner 引用**）：join 旧线程 + ffmpeg 打开 URL（耗时大头）
    /// 3. 主线程持锁瞬间：构造 sink + attach + emit stateChanged
    /// 持锁阶段都是纯内存操作，主线程其它同步 NAPI 调用最多等几微秒，不会被 IO 卡住
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
    ) -> Result<JsMusicMetadata> {
        use crate::decoder;
        use crate::shared::Shared;

        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "加载音频源");

        // 阶段 1：主线程持锁瞬间，take 所有旧线程 handle + 拿参数 + 拿 load token
        let (old_threads, token, cover_dir, normalization_enabled) = {
            let mut player = self.inner.lock();
            let (old_threads, token) = player.take_for_async_load();
            player.ensure_output_pub().into_napi()?;
            (
                old_threads,
                token,
                player.cover_cache_dir().map(String::from),
                player.is_normalization_enabled(),
            )
        };

        // 创建 shared（不持锁）
        let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
        shared.set_normalization_enabled(normalization_enabled);
        let shared_for_decoder = Arc::clone(&shared);
        let source_for_decoder = source.clone();

        // 阶段 2：工作线程（不持有 inner 引用）—— join 旧 timer/fade/decoder + 跑 ffmpeg open URL
        let (metadata, decode_handle) = tokio::task::spawn_blocking(move || {
            // 先 join 所有旧辅助线程（timer/fade），再 join 旧解码线程
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            decoder::start_decode(
                &source_for_decoder,
                shared_for_decoder,
                cover_dir.as_deref(),
            )
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?
        .into_napi()?;

        // 阶段 3：主线程持锁瞬间，attach 新资源
        // commit_loaded 内部比对 token，被新 load 抢占时返回 None：丢弃本次结果，避免覆盖
        let returned_meta = {
            let mut player = self.inner.lock();
            player
                .commit_loaded(token, &source, auto_play, metadata, decode_handle, shared)
                .into_napi()?
        };

        match returned_meta {
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(Error::from_reason("load 已被更新的 load 取代")),
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

    /// 恢复播放。如果已停止或播放结束，自动从头重新加载。
    #[napi]
    pub fn play(&self) -> Result<()> {
        self.inner.lock().play().into_napi()
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
        use crate::decoder;
        use crate::shared::Shared;

        // 阶段 1：主线程持锁瞬间，take 旧资源
        let take = {
            let mut player = self.inner.lock();
            player.take_for_async_seek()
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source,
            was_playing,
        } = take;

        // 阶段 2：工作线程（不持有 inner 引用）—— join 旧 timer/fade/decoder + ffmpeg seek + 启动新解码
        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            // 关键：清掉中断标志再 seek
            // take_for_async_seek 调过 old_shared.stop()，已把 interrupt_flag 设为 true，
            // 否则 ffmpeg 的 avformat_seek_file 一进入就会被中断回调拒绝
            decoder_data.reset_interrupt();
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            let handle = decoder::resume_decode(decoder_data, Arc::clone(&shared));
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| Error::from_reason(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                // 阶段 3：主线程持锁瞬间，attach
                let mut player = self.inner.lock();
                player.commit_seeked(position, shared, handle).into_napi()
            }
            SeekOutcome::Fallback => {
                // seek 失败（线程 panic 或 ffmpeg seek 出错），回退到完整 load 重新打开
                if let Some(src) = current_source {
                    self.load(src, Some(was_playing)).await?;
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
    pub fn get_fft_data(&self) -> Vec<f64> {
        self.inner
            .lock()
            .fft_data()
            .into_iter()
            .map(|v| v as f64)
            .collect()
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
        player::InnerPlayer::get_output_devices()
            .into_iter()
            .map(|(name, is_default)| JsAudioDevice { name, is_default })
            .collect()
    }

    /// 获取系统默认输出设备名称
    #[napi]
    pub fn get_default_device_name(&self) -> Option<String> {
        player::InnerPlayer::get_default_device_name()
    }

    /// 切换输出设备（传 None/undefined 使用系统默认）
    #[napi]
    pub fn set_output_device(&self, device_name: Option<String>) -> Result<()> {
        info!(device = ?device_name, "切换输出设备");
        self.inner.lock().set_output_device(device_name).into_napi()
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

// ─── 批量扫描 ─────────────────────────────────────────────────────────────────

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

/// 扫描事件回调数据
#[napi(object)]
#[derive(Default)]
pub struct JsScanEvent {
    /// "progress" | "done" | "error"
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
    /// 错误信息（仅 error 事件）
    pub error: Option<String>,
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
    let tsfn = callback.build_threadsafe_function().build()?;

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
                    tracks: Some(
                        tracks
                            .into_iter()
                            .map(|t| JsScannedTrack {
                                path: t.path,
                                title: t.title,
                                artist: t.artist,
                                album: t.album,
                                duration: t.duration,
                                codec: t.codec,
                                sample_rate: t.sample_rate,
                                bit_rate: t.bit_rate,
                                channels: t.channels,
                                bits_per_sample: t.bits_per_sample,
                                cover: t.cover,
                                file_size: t.file_size as f64,
                                mtime: t.mtime as f64,
                                ctime: t.ctime as f64,
                            })
                            .collect(),
                    ),
                    ..Default::default()
                },
                scanner::ScanEvent::Done {
                    scanned,
                    total,
                    removed_paths,
                } => JsScanEvent {
                    event_type: "done".into(),
                    scanned,
                    total,
                    removed_paths: Some(removed_paths),
                    ..Default::default()
                },
                scanner::ScanEvent::Error {
                    scanned,
                    total,
                    error,
                } => JsScanEvent {
                    event_type: "error".into(),
                    scanned,
                    total,
                    error: Some(error),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
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
