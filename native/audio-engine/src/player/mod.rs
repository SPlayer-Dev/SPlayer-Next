use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::Result;
use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;
use tracing::{debug, info};

use crate::audio_output::{AudioOutput, ExclusiveFallbackCallback, OutputFailureCallback};
use crate::decoder;
use crate::equalizer::{Equalizer, EQ_BAND_COUNT};
use crate::fft::FftAnalyzer;
use crate::playback::PlaybackHandle;
use crate::shared::Shared;
use crate::tempo::StretchProcessor;

mod background;
mod events;
mod transition;

#[cfg(test)]
use events::playback_completion_event;
pub use events::{EventEmitter, PlayerEvent, PlayerState};
pub use transition::{LoadedPlayback, SeekTake};

/// 内部播放器，管理音频输出、解码和状态
pub struct InnerPlayer {
    /// 输出设备与配置句柄（不持有流），保证 InnerPlayer 整体是 Send 的
    output: Option<AudioOutput>,
    /// 使用 Arc 包装，允许 fade 线程在 Mutex 外操作音量
    playback: Option<Arc<PlaybackHandle>>,
    shared: Option<Arc<Shared>>,
    /// 解码线程句柄，join 后可回收 DecoderData 复用于 seek
    decoder_thread: Option<JoinHandle<decoder::DecoderData>>,
    fft: Arc<FftAnalyzer>,
    /// 当前音频的时长（秒）
    audio_duration: f64,
    /// 原始封面数据缓存（load 时提取，getCoverRaw 时返回，避免重复打开文件）
    cover_raw: Option<Vec<u8>>,
    state: PlayerState,
    /// seek 偏移基准（秒），采样计数在此基础上累加
    seek_base: f64,
    /// 当前音频源路径/地址
    current_source: Option<String>,
    /// 用户设置的目标音量（fade 期间 sink 音量会变化，需要记住目标值）
    target_volume: f32,
    /// 渐变时长（毫秒），0 表示禁用
    fade_duration_ms: u64,
    /// 封面缓存目录
    cover_cache_dir: Option<String>,
    /// 事件回调（由 NAPI 绑定层设置，内部转发到 JS ThreadsafeFunction）
    event_callback: Option<EventEmitter>,
    /// 位置推送定时器的停止信号和线程句柄
    position_timer_stop: Option<Arc<AtomicBool>>,
    position_timer_handle: Option<JoinHandle<()>>,
    /// 渐变取消信号和线程句柄
    fade_cancel: Option<Arc<AtomicBool>>,
    fade_handle: Option<JoinHandle<()>>,
    /// FFT 推送开关（前端需要显示频谱时才启用）
    fft_enabled: Arc<AtomicBool>,
    /// FFT 推送定时器的停止信号和线程句柄
    fft_timer_stop: Option<Arc<AtomicBool>>,
    fft_timer_handle: Option<JoinHandle<()>>,
    /// 用户选择的输出设备（设备 ID，None = 跟随系统默认）
    selected_device: Option<String>,
    /// 音量归一化开关
    normalization_enabled: bool,
    /// 跨曲目共享的均衡器（load/seek 时交给 DSP 线程）
    equalizer: Arc<Mutex<Equalizer>>,
    /// 跨曲目共享的变速变调处理器（load/seek 时交给 DSP 线程，
    /// set_speed/set_pitch/set_pitch_sync 直接锁此字段更新参数）
    tempo: Arc<Mutex<StretchProcessor>>,
    /// load 单调递增 token：每次 take_for_async_load 自增一次
    /// commit_loaded 比对 token 与最新值，不一致则该次加载已被新加载取代，需丢弃
    /// 用于防止快速切歌时旧 IO 完成后覆盖新音频的竞态
    load_token: Arc<AtomicU64>,
    /// 当前输出流代次。错误回调仅允许上报与此值一致的输出，避免旧流销毁后的迟到事件重建新流。
    output_generation: Arc<AtomicU64>,
    /// 当前音频源的原始采样率
    original_sample_rate: u32,
    /// 当前音频源的有效位深，独占模式协商候选的优先依据
    original_bits: u32,
    /// WASAPI 独占模式开关（仅 Windows 生效，重建设备时生效）
    exclusive_mode: bool,
    /// 正在打开的网络音源中断句柄，确保切歌和 stop 能取消元数据探测
    pending_load_handle: Option<HttpCancelHandle>,
}

/// 编译期保证 `InnerPlayer: Send`：cpal::Stream 由 `PlaybackHandle` 持有且各后端均为 Send，
/// 此处不再需要 `unsafe impl Send`。如果未来有人加了 !Send 字段，这条断言会编译失败提醒。
const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<InnerPlayer>();
};

impl InnerPlayer {
    /// 未初始化时通过 `AudioOutput::new` 懒构造音频输出。
    /// 设备失效时的重建由 `reinit_output` 显式处理，不在此函数内自动恢复
    fn ensure_output(&mut self, requested_sample_rate: Option<u32>) -> Result<&AudioOutput> {
        if self.output.is_none() {
            let generation = self.reserve_output_generation();
            let on_failure = self.make_failure_callback(generation);
            let on_fallback = self.make_fallback_callback(generation);
            let exclusive = self.exclusive_mode.then_some(on_fallback);
            self.output = Some(AudioOutput::new(
                self.selected_device.as_deref(),
                requested_sample_rate,
                None,
                generation,
                on_failure,
                exclusive.as_ref(),
            )?);
        }
        self.output
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("ensure_output 后置条件违反"))
    }

    /// 构造输出失败回调：只发送轻量 `PlayerEvent::OutputFailed`，
    /// 禁止在实时错误线程做任何阻塞操作
    pub fn make_failure_callback(&self, generation: u64) -> OutputFailureCallback {
        let Some(cb) = self.event_callback.as_ref().map(Arc::clone) else {
            return std::sync::Arc::new(|| {});
        };
        let active_generation = Arc::clone(&self.output_generation);
        std::sync::Arc::new(move || {
            if active_generation.load(Ordering::Acquire) == generation {
                cb(PlayerEvent::OutputFailed);
            }
        })
    }

    /// 构造独占模式回退回调：只发送轻量 `PlayerEvent::OutputFallback`
    pub fn make_fallback_callback(&self, generation: u64) -> ExclusiveFallbackCallback {
        let Some(cb) = self.event_callback.as_ref().map(Arc::clone) else {
            return std::sync::Arc::new(|_| {});
        };
        let active_generation = Arc::clone(&self.output_generation);
        std::sync::Arc::new(move |reason: &str| {
            if active_generation.load(Ordering::Acquire) == generation {
                cb(PlayerEvent::OutputFallback {
                    reason: reason.to_string(),
                });
            }
        })
    }

    /// 预留下一代输出流，并立即使旧输出的回调失效。
    pub fn reserve_output_generation(&self) -> u64 {
        self.output_generation.fetch_add(1, Ordering::AcqRel) + 1
    }

    /// 当前实际输出流采样率（播放重采样目标）
    pub fn output_sample_rate(&self) -> u32 {
        self.output
            .as_ref()
            .map(|out| out.sample_rate())
            .unwrap_or(decoder::DEFAULT_TARGET_SAMPLE_RATE)
    }

    /// 当前实际输出流声道数
    pub fn output_channels(&self) -> u16 {
        self.output
            .as_ref()
            .map(AudioOutput::channels)
            .unwrap_or(decoder::DEFAULT_OUTPUT_CHANNELS)
    }

    pub fn new() -> Result<Self> {
        // 延迟初始化：构造时不要求有音频设备，load 时再打开
        let output = None;
        let initial_rate = decoder::DEFAULT_TARGET_SAMPLE_RATE;
        debug!("InnerPlayer 已创建");

        Ok(Self {
            output,
            playback: None,
            shared: None,
            decoder_thread: None,
            fft: Arc::new(FftAnalyzer::new()),
            audio_duration: 0.0,
            cover_raw: None,
            state: PlayerState::Idle,
            seek_base: 0.0,
            current_source: None,
            target_volume: 1.0,
            fade_duration_ms: 200,
            cover_cache_dir: None,
            event_callback: None,
            position_timer_stop: None,
            position_timer_handle: None,
            fade_cancel: None,
            fade_handle: None,
            fft_enabled: Arc::new(AtomicBool::new(false)),
            fft_timer_stop: None,
            fft_timer_handle: None,
            selected_device: None,
            normalization_enabled: false,
            equalizer: Arc::new(Mutex::new(Equalizer::new(
                initial_rate,
                decoder::DEFAULT_OUTPUT_CHANNELS,
            ))),
            tempo: Arc::new(Mutex::new(StretchProcessor::new(
                decoder::DEFAULT_OUTPUT_CHANNELS,
                initial_rate,
            ))),
            load_token: Arc::new(AtomicU64::new(0)),
            output_generation: Arc::new(AtomicU64::new(0)),
            original_sample_rate: decoder::DEFAULT_TARGET_SAMPLE_RATE,
            original_bits: 16,
            exclusive_mode: false,
            pending_load_handle: None,
        })
    }

    /// 切换输出设备（下一次重建设备时生效）
    pub fn set_output_device(&mut self, device_id: Option<String>) {
        info!(device = ?device_id, "切换输出设备");
        self.selected_device = device_id;
    }

    /// 设置独占模式开关（下一次重建设备时生效）
    pub fn set_exclusive_mode(&mut self, enabled: bool) {
        info!(enabled, "切换音频输出模式");
        self.exclusive_mode = enabled;
    }

    /// 独占模式开关是否已启用
    pub fn is_exclusive_mode(&self) -> bool {
        self.exclusive_mode
    }

    /// 获取当前选择的输出设备（None = 跟随系统默认）
    pub fn selected_device(&self) -> Option<&str> {
        self.selected_device.as_deref()
    }

    /// 注册事件回调（支持热替换：先停止旧的定时器/渐变，确保旧回调的 Arc 引用尽快释放）
    pub fn set_event_callback(&mut self, cb: EventEmitter) {
        self.stop_position_timer();
        self.stop_fft_timer();
        self.cancel_fade();
        self.event_callback = Some(cb);
    }

    /// 发射事件
    fn emit(&self, event: PlayerEvent) {
        if let Some(cb) = &self.event_callback {
            cb(event);
        }
    }

    /// 对外发 SourceError：供 NAPI 绑定层在远端源重开失败时通知 JS 重新解析
    pub fn emit_source_error(&self) {
        self.emit(PlayerEvent::SourceError);
    }

    /// 设置封面缓存目录
    pub fn set_cover_cache_dir(&mut self, dir: String) {
        self.cover_cache_dir = Some(dir);
    }

    /// 暴露给 NAPI 绑定层：封面缓存目录
    pub fn cover_cache_dir(&self) -> Option<&str> {
        self.cover_cache_dir.as_deref()
    }

    /// 暴露给 NAPI 绑定层：归一化开关
    pub fn is_normalization_enabled(&self) -> bool {
        self.normalization_enabled
    }

    /// 当前音频源路径/地址
    pub fn current_source(&self) -> Option<&str> {
        self.current_source.as_deref()
    }

    /// 恢复播放。Paused 时渐入恢复；Stopped/Idle/已播完时返回 Some(source)，
    /// 由 NAPI 绑定层走 async load 复活——网络源的打开可达数秒，不能在锁内同步执行
    pub fn play(&mut self) -> Result<Option<String>> {
        // 如果当前在"播放"状态但实际已结束，先标记为停止
        // 此时解码线程已自然退出，stop_internal 的 join 立即返回，不会阻塞
        if self.state == PlayerState::Playing && self.is_finished() {
            self.stop_internal();
            self.state = PlayerState::Stopped;
        }

        match self.state {
            // 已经在播放且未结束，忽略
            PlayerState::Playing => Ok(None),
            // 暂停状态：渐入恢复
            PlayerState::Paused => {
                // 如果没有有效的播放链路或解码线程，交给调用方从当前音源重载复活
                if self.playback.is_none() || self.decoder_thread.is_none() {
                    return Ok(self.current_source.clone());
                }

                // 先取消未完成的渐出：否则其完成回调可能在 sink.play() 之后执行
                // sink.pause()，导致状态 Playing 但实际无声
                self.cancel_fade();
                if let Some(ref playback) = self.playback {
                    playback.set_volume(0.0);
                    playback.play();
                }

                self.state = PlayerState::Playing;
                self.emit(PlayerEvent::StateChanged {
                    state: PlayerState::Playing,
                });
                self.start_position_timer();
                self.start_fft_timer();

                // 非阻塞渐入
                self.start_fade(0.0, self.target_volume, None);
                Ok(None)
            }
            // 停止/空闲/播放结束：交给调用方异步从头重新加载
            PlayerState::Stopped | PlayerState::Idle => Ok(self.current_source.clone()),
        }
    }

    /// 暂停播放（非阻塞渐出，渐出完成后 sink.pause）
    pub fn pause(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }

        // 先切换状态并发射事件，让前端立即响应
        self.state = PlayerState::Paused;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Paused,
        });

        // 立即启动非阻塞渐出，避免被后续 stop_*_timer 的 join 阻塞
        // fade 完成后在回调中执行 sink.pause（保持静音，不恢复音量以免串音或爆音）
        let playback_for_callback = self.playback.as_ref().map(Arc::clone);
        self.start_fade(
            self.target_volume,
            0.0,
            Some(Box::new(move || {
                if let Some(playback) = playback_for_callback {
                    playback.pause();
                }
            })),
        );

        // 渐出已在后台运行，再同步停止定时器（join 开销不会影响音频淡出时序）
        self.stop_position_timer();
        self.stop_fft_timer();
    }

    /// 立即暂停播放，用于切换输出设备前阻止短暂串音
    pub fn pause_immediately(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }
        self.cancel_fade();
        if let Some(ref playback) = self.playback {
            playback.pause();
        }
        self.state = PlayerState::Paused;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Paused,
        });
        self.stop_position_timer();
        self.stop_fft_timer();
    }

    /// 恢复失败后保留当前曲目与位置，播放器进入暂停态
    ///
    /// 不转 Stopped（避免 JS 按"播放结束"自动切歌），等待有限重试或用户手动操作。
    pub fn enter_paused_for_recovery(&mut self) {
        if self.state != PlayerState::Paused {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        }
    }

    /// 停止播放并释放资源
    /// 显式停止：清掉 current_source，避免后续 play() 在 Stopped 态下用残留源复活上一首
    /// （`stop_internal` 是内部过渡用，不清；load() 会立即用新源覆盖）
    pub fn stop(&mut self) {
        // 使在途的 async load/seek 在 commit 时被拒绝，防止 stop 后被复活
        self.load_token.fetch_add(1, Ordering::AcqRel);
        if let Some(handle) = self.pending_load_handle.take() {
            handle.cancel();
        }
        self.stop_internal();
        self.current_source = None;
        self.state = PlayerState::Stopped;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Stopped,
        });
    }

    fn stop_internal(&mut self) {
        // 1. 取消渐变并等待渐变线程退出（释放 Arc<Sink>）
        self.cancel_fade();
        // 2. 停止定时器并等待线程退出（释放 Arc<Shared> 和 Arc<EventEmitter>）
        self.stop_position_timer();
        self.stop_fft_timer();
        // 3. 通知解码线程停止
        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        // 4. 释放 Sink（drop DecoderSource，解除迭代器阻塞）
        if let Some(playback) = self.playback.take() {
            playback.stop();
        }
        // 5. 等待解码线程退出，回收 DecoderData（FFmpeg 资源在此 drop）
        if let Some(handle) = self.decoder_thread.take() {
            let _ = handle.join();
        }
        // 6. 清空共享缓冲区（即使还有外部 Arc 引用，缓冲区数据也立即释放）
        if let Some(ref shared) = self.shared {
            shared.drain_buffer();
        }
        self.shared = None;
        self.cover_raw = None;
        self.seek_base = 0.0;
    }

    /// 设置音量（0.0 ~ 1.0）
    pub fn set_volume(&mut self, volume: f32) {
        self.target_volume = volume;
        if let Some(ref playback) = self.playback {
            playback.set_volume(volume);
        }
    }

    /// 获取当前音量
    pub fn volume(&self) -> f32 {
        self.target_volume
    }

    /// 设置渐变时长（毫秒），0 表示禁用渐变
    pub fn set_fade_duration(&mut self, duration_ms: u64) {
        self.fade_duration_ms = duration_ms;
    }

    /// 获取渐变时长（毫秒）
    pub fn fade_duration(&self) -> u64 {
        self.fade_duration_ms
    }

    /// 获取当前播放位置（秒），基于实际消费的采样数
    pub fn position(&self) -> f64 {
        match &self.shared {
            Some(shared) => self.seek_base + shared.consumed_position(),
            None => self.seek_base,
        }
    }

    /// 获取总时长（秒）
    pub fn duration(&self) -> f64 {
        self.audio_duration
    }

    /// 获取当前播放状态
    pub fn state(&self) -> PlayerState {
        self.state
    }

    /// 获取 FFT 频谱数据（128 个频段）
    pub fn fft_data(&self) -> (Vec<f32>, Vec<f32>) {
        self.fft.analyze()
    }

    /// 获取缓存的原始封面数据（load 时一次性提取）
    pub fn cover_raw(&self) -> Option<&[u8]> {
        self.cover_raw.as_deref()
    }

    /// 检查播放是否已结束
    pub fn is_finished(&self) -> bool {
        match (&self.shared, &self.playback) {
            (Some(shared), Some(_)) => shared.is_all_consumed(),
            _ => false,
        }
    }

    /// 设置音量归一化开关
    pub fn set_normalization_enabled(&mut self, enabled: bool) {
        self.normalization_enabled = enabled;
        if let Some(ref shared) = self.shared {
            shared.set_normalization_enabled(enabled);
        }
    }

    /// 获取音量归一化开关状态
    pub fn normalization_enabled(&self) -> bool {
        self.normalization_enabled
    }

    /// 设置均衡器开关
    pub fn set_equalizer_enabled(&mut self, enabled: bool) {
        self.equalizer.lock().set_enabled(enabled);
    }

    /// 获取均衡器开关状态
    pub fn equalizer_enabled(&self) -> bool {
        self.equalizer.lock().enabled()
    }

    /// 更新所有频段增益（dB），长度需为 EQ_BAND_COUNT
    pub fn set_equalizer_bands(&mut self, gains_db: &[f32]) {
        self.equalizer.lock().set_band_gains(gains_db);
    }

    /// 获取所有频段当前增益（dB）
    pub fn equalizer_bands(&self) -> [f32; EQ_BAND_COUNT] {
        self.equalizer.lock().band_gains_db()
    }

    /// 设置前级增益（dB，自动 clamp 到 ±12）
    pub fn set_preamp_gain(&mut self, db: f32) {
        self.equalizer.lock().set_preamp_db(db);
    }

    /// 获取前级增益（dB）
    pub fn preamp_gain(&self) -> f32 {
        self.equalizer.lock().preamp_db()
    }

    /// 设置播放速度（自动 clamp 到 [0.5, 2.0]）
    pub fn set_speed(&mut self, speed: f32) {
        self.tempo.lock().set_speed(speed);
    }

    /// 设置音调偏移（半音，自动 clamp 到 [-12, 12]）。
    /// sync=ON 时立即下发；sync=OFF 时只更新内部值，不影响声音
    pub fn set_pitch(&mut self, semitones: i8) {
        self.tempo.lock().set_pitch(semitones);
    }

    /// 设置"音调同步"开关（true = 变速保音调，默认）
    pub fn set_pitch_sync(&mut self, sync: bool) {
        self.tempo.lock().set_pitch_sync(sync);
    }

    /// 获取当前播放速度
    pub fn speed(&self) -> f32 {
        self.tempo.lock().speed()
    }

    /// 获取当前音调（半音）
    pub fn pitch(&self) -> i8 {
        self.tempo.lock().pitch()
    }

    /// 获取"音调同步"开关
    pub fn pitch_sync(&self) -> bool {
        self.tempo.lock().pitch_sync()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn decode_failure_mid_stream_emits_source_error() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 120.0, 30.0),
            PlayerEvent::SourceError
        ));
    }

    #[test]
    fn decode_failure_near_end_is_treated_as_ended() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 120.0, 118.0),
            PlayerEvent::Ended
        ));
    }

    #[test]
    fn unknown_duration_failure_emits_source_error() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 0.0, 30.0),
            PlayerEvent::SourceError
        ));
    }

    #[test]
    fn stale_output_failure_callback_is_ignored() {
        let mut player = InnerPlayer::new().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_event = Arc::clone(&calls);
        player.set_event_callback(Arc::new(move |event| {
            if matches!(event, PlayerEvent::OutputFailed) {
                calls_for_event.fetch_add(1, Ordering::Relaxed);
            }
        }));

        let generation = player.reserve_output_generation();
        let callback = player.make_failure_callback(generation);
        callback();
        assert_eq!(calls.load(Ordering::Relaxed), 1);

        player.reserve_output_generation();
        callback();
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
}
