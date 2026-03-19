use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};

use crate::decoder::{self, AudioMetadata, Shared};
use crate::fft::FftAnalyzer;

/// 播放器推送给 JS 侧的事件类型
#[derive(Clone, Debug)]
pub enum PlayerEvent {
    /// 状态变化（playing / paused / stopped / idle）
    StateChanged { state: &'static str },
    /// 播放结束
    Ended,
    /// 位置更新（秒）—— 由内部定时器推送
    Position { position: f64, duration: f64 },
}

/// 事件发射器类型（跨线程安全）
pub type EventEmitter = Arc<dyn Fn(PlayerEvent) + Send + Sync>;

/// 渐变步数
const FADE_STEPS: u32 = 20;

/// 可取消的渐变：在独立线程中逐步调整音量，cancel 为 true 时提前退出
fn fade_volume(sink: &Sink, from: f32, to: f32, duration_ms: u64, cancel: &AtomicBool) {
    if duration_ms == 0 {
        sink.set_volume(to);
        return;
    }
    let step_duration = Duration::from_millis(duration_ms / FADE_STEPS as u64);
    for i in 1..=FADE_STEPS {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let t = i as f32 / FADE_STEPS as f32;
        sink.set_volume(from + (to - from) * t);
        thread::sleep(step_duration);
    }
}

/// rodio 音频源，从共享缓冲区拉取样本。
/// 使用 condvar 阻塞等待数据，不会返回静音填充。
struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// 本地缓冲，减少锁竞争
    local_buffer: VecDeque<f32>,
    sample_rate: u32,
    channels: u16,
}

impl DecoderSource {
    fn new(shared: Arc<Shared>, fft: Arc<FftAnalyzer>, sample_rate: u32, channels: u16) -> Self {
        Self {
            shared,
            fft,
            local_buffer: VecDeque::new(),
            sample_rate,
            channels,
        }
    }
}

impl Iterator for DecoderSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        // 快速路径：从本地缓冲返回（无原子操作）
        if let Some(sample) = self.local_buffer.pop_front() {
            return Some(sample);
        }

        // 慢速路径：从共享缓冲区阻塞获取，跳过空数据块
        loop {
            if let Some(chunk) = self.shared.pop() {
                // 将 FFT 样本推送给分析器
                if !chunk.fft_samples.is_empty() {
                    self.fft.push_samples(&chunk.fft_samples);
                }

                // 填充本地缓冲，一次性批量计数（而非逐采样）
                if !chunk.player_samples.is_empty() {
                    let count = chunk.player_samples.len() as u64;
                    self.local_buffer.extend(chunk.player_samples);
                    self.shared.advance_consumed(count);
                    return self.local_buffer.pop_front();
                }
                // 空数据块（重采样器预热期），继续获取下一个
            } else {
                // 数据源耗尽，标记消费完毕
                self.shared.mark_all_consumed();
                return None;
            }
        }
    }
}

impl Source for DecoderSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// 播放状态
#[derive(Clone, Copy, PartialEq)]
pub enum PlayerState {
    Idle,
    Playing,
    Paused,
    Stopped,
}

/// 内部播放器，管理音频输出、解码和状态
pub struct InnerPlayer {
    _stream: OutputStream,
    stream_handle: OutputStreamHandle,
    /// 使用 Arc 包装，允许 fade 线程在 Mutex 外操作音量
    sink: Option<Arc<Sink>>,
    shared: Option<Arc<Shared>>,
    /// 解码线程句柄，stop 时 join 确保线程清理
    decoder_thread: Option<JoinHandle<()>>,
    fft: Arc<FftAnalyzer>,
    metadata: Option<AudioMetadata>,
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
    /// 事件回调（由 lib.rs 设置，内部转发到 JS ThreadsafeFunction）
    event_callback: Option<EventEmitter>,
    /// 位置推送定时器的停止信号
    position_timer_stop: Option<Arc<AtomicBool>>,
    /// 渐变取消信号（快速连续 play/pause 时取消上一次渐变）
    fade_cancel: Option<Arc<AtomicBool>>,
}

impl InnerPlayer {
    pub fn new() -> Result<Self> {
        let (stream, stream_handle) =
            OutputStream::try_default().context("Failed to open audio output device")?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink: None,
            shared: None,
            decoder_thread: None,
            fft: Arc::new(FftAnalyzer::new(decoder::FFT_SAMPLE_RATE)),
            metadata: None,
            state: PlayerState::Idle,
            seek_base: 0.0,
            current_source: None,
            target_volume: 1.0,
            fade_duration_ms: 200,
            cover_cache_dir: None,
            event_callback: None,
            position_timer_stop: None,
            fade_cancel: None,
        })
    }

    /// 注册事件回调（支持热替换：先停止旧的定时器/渐变，确保旧回调的 Arc 引用尽快释放）
    pub fn set_event_callback(&mut self, cb: EventEmitter) {
        self.stop_position_timer();
        self.cancel_fade();
        self.event_callback = Some(cb);
    }

    /// 发射事件
    fn emit(&self, event: PlayerEvent) {
        if let Some(cb) = &self.event_callback {
            cb(event);
        }
    }

    /// 取消正在进行的渐变
    fn cancel_fade(&mut self) {
        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// 启动非阻塞渐变（独立线程执行，不阻塞调用方）
    fn start_fade(&mut self, from: f32, to: f32, on_complete: Option<Box<dyn FnOnce() + Send>>) {
        self.cancel_fade();

        let cancel = Arc::new(AtomicBool::new(false));
        self.fade_cancel = Some(Arc::clone(&cancel));

        if let Some(ref sink) = self.sink {
            let sink = Arc::clone(sink);
            let fade_ms = self.fade_duration_ms;
            thread::spawn(move || {
                fade_volume(&sink, from, to, fade_ms, &cancel);
                // 渐变未被取消时执行完成回调
                if !cancel.load(Ordering::Relaxed) {
                    if let Some(f) = on_complete {
                        f();
                    }
                }
            });
        }
    }

    /// 启动位置推送定时器（在独立线程中运行，每 200ms 推送一次位置）
    fn start_position_timer(&mut self) {
        self.stop_position_timer();

        let stop_flag = Arc::new(AtomicBool::new(false));
        self.position_timer_stop = Some(Arc::clone(&stop_flag));

        let shared = match &self.shared {
            Some(s) => Arc::clone(s),
            None => return,
        };
        let cb = match &self.event_callback {
            Some(cb) => Arc::clone(cb),
            None => return,
        };
        let seek_base = self.seek_base;
        let duration = self.duration();

        thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                let position = seek_base + shared.consumed_position();
                cb(PlayerEvent::Position { position, duration });

                // 检测播放结束：all_consumed 表示 rodio 侧已消费完所有数据
                if shared.is_all_consumed() {
                    cb(PlayerEvent::Ended);
                    cb(PlayerEvent::StateChanged { state: "stopped" });
                    break;
                }

                thread::sleep(Duration::from_millis(200));
            }
        });
    }

    /// 停止位置推送定时器
    fn stop_position_timer(&mut self) {
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// 重新初始化音频输出设备（系统休眠唤醒后调用，恢复失效的 OutputStream 句柄）
    ///
    /// 保存当前播放状态（来源、位置、音量），重建音频输出后自动恢复：
    /// - Playing → seek 到原位置继续播放
    /// - Paused  → seek 到原位置并暂停
    /// - 其他状态 → 仅重建输出，不恢复播放
    pub fn reinit_output(&mut self) -> Result<()> {
        // 保存当前状态
        let prev_state = self.state;
        let prev_source = self.current_source.clone();
        let prev_position = self.position();
        let prev_volume = self.target_volume;

        // 停止当前播放（释放旧的 Sink / 解码线程）
        self.stop_internal();

        // 重建音频输出
        let (stream, stream_handle) =
            OutputStream::try_default().context("Failed to reopen audio output device")?;
        self._stream = stream;
        self.stream_handle = stream_handle;

        // 恢复播放状态
        match prev_state {
            PlayerState::Playing | PlayerState::Paused => {
                if let Some(source) = prev_source {
                    self.load(&source)?;
                    if prev_position > 0.5 {
                        self.seek(prev_position)?;
                    }
                    if prev_state == PlayerState::Paused {
                        self.pause();
                    }
                    self.set_volume(prev_volume);
                } else {
                    self.state = PlayerState::Idle;
                }
            }
            _ => {
                self.state = prev_state;
            }
        }

        Ok(())
    }

    /// 设置封面缓存目录
    pub fn set_cover_cache_dir(&mut self, dir: String) {
        self.cover_cache_dir = Some(dir);
    }

    /// 加载并播放音频源（本地路径或网络地址）
    pub fn load(&mut self, source: &str) -> Result<AudioMetadata> {
        self.stop_internal();
        self.fft.reset();

        let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
        let (metadata, handle) =
            decoder::start_decode(source, Arc::clone(&shared), self.cover_cache_dir.as_deref())?;

        let sink =
            Arc::new(Sink::try_new(&self.stream_handle).context("Failed to create audio sink")?);

        let decoder_source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::clone(&self.fft),
            metadata.sample_rate,
            metadata.channels,
        );

        sink.set_volume(self.target_volume);
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.metadata = Some(metadata.clone());
        self.state = PlayerState::Playing;
        self.seek_base = 0.0;
        self.current_source = Some(source.to_string());

        self.emit(PlayerEvent::StateChanged { state: "playing" });
        self.start_position_timer();

        Ok(metadata)
    }

    /// 恢复播放。如果已停止、播放结束或空闲，自动从头重新加载。
    pub fn play(&mut self) -> Result<()> {
        // 如果当前在"播放"状态但实际已结束，先标记为停止
        if self.state == PlayerState::Playing && self.is_finished() {
            self.stop_internal();
            self.state = PlayerState::Stopped;
        }

        match self.state {
            // 已经在播放且未结束，忽略
            PlayerState::Playing => {}
            // 暂停状态：渐入恢复
            PlayerState::Paused => {
                if let Some(ref sink) = self.sink {
                    sink.set_volume(0.0);
                    sink.play();
                }

                self.state = PlayerState::Playing;
                self.emit(PlayerEvent::StateChanged { state: "playing" });
                self.start_position_timer();

                // 非阻塞渐入
                self.start_fade(0.0, self.target_volume, None);
            }
            // 停止/空闲/播放结束：从头重新加载
            PlayerState::Stopped | PlayerState::Idle => {
                if let Some(source) = self.current_source.clone() {
                    self.load(&source)?;
                }
            }
        }
        Ok(())
    }

    /// 暂停播放（非阻塞渐出，渐出完成后 sink.pause）
    pub fn pause(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }

        // 立即切换状态、停止定时器、发射事件
        self.stop_position_timer();
        self.state = PlayerState::Paused;
        self.emit(PlayerEvent::StateChanged { state: "paused" });

        // 非阻塞渐出：fade 完成后在回调中执行 sink.pause + 恢复音量
        let target_volume = self.target_volume;
        let sink_for_callback = self.sink.as_ref().map(Arc::clone);
        self.start_fade(
            target_volume,
            0.0,
            Some(Box::new(move || {
                if let Some(sink) = sink_for_callback {
                    sink.pause();
                    sink.set_volume(target_volume);
                }
            })),
        );
    }

    /// 停止播放并释放资源
    pub fn stop(&mut self) {
        self.stop_internal();
        self.state = PlayerState::Stopped;
        self.emit(PlayerEvent::StateChanged { state: "stopped" });
    }

    fn stop_internal(&mut self) {
        self.cancel_fade();
        self.stop_position_timer();
        // 先通知解码线程停止
        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        // 释放 Sink（会 drop DecoderSource，解除迭代器阻塞）
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        // 等待解码线程退出，避免线程泄漏
        if let Some(handle) = self.decoder_thread.take() {
            let _ = handle.join();
        }
        self.shared = None;
        self.seek_base = 0.0;
    }

    /// 跳转到指定位置（秒）
    pub fn seek(&mut self, position_secs: f64) -> Result<()> {
        let source = self.current_source.clone().context("No source loaded")?;

        self.cancel_fade();
        self.stop_position_timer();

        // 停止当前播放和解码线程
        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        if let Some(handle) = self.decoder_thread.take() {
            let _ = handle.join();
        }

        self.fft.reset();

        // 创建新的共享状态用于 seek 后的解码
        let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
        let shared_for_thread = Arc::clone(&shared);

        let source_clone = source;
        let handle = std::thread::spawn(move || {
            let _ = decoder::seek_decode(&source_clone, position_secs, &shared_for_thread);
        });

        let sink =
            Arc::new(Sink::try_new(&self.stream_handle).context("Failed to create audio sink")?);

        let metadata = self.metadata.as_ref().context("No metadata available")?;
        let decoder_source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::clone(&self.fft),
            metadata.sample_rate,
            metadata.channels,
        );

        sink.set_volume(self.target_volume);
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.seek_base = position_secs;
        self.state = PlayerState::Playing;

        self.emit(PlayerEvent::StateChanged { state: "playing" });
        self.start_position_timer();

        Ok(())
    }

    /// 设置音量（0.0 ~ 1.0）
    pub fn set_volume(&mut self, volume: f32) {
        self.target_volume = volume;
        if let Some(ref sink) = self.sink {
            sink.set_volume(volume);
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
        self.metadata.as_ref().map_or(0.0, |m| m.duration_secs)
    }

    /// 获取当前播放状态
    pub fn state(&self) -> PlayerState {
        self.state
    }

    /// 获取 FFT 频谱数据（128 个频段）
    pub fn fft_data(&self) -> Vec<f32> {
        self.fft.analyze()
    }

    /// 获取当前音频源路径
    pub fn current_source(&self) -> Option<&str> {
        self.current_source.as_deref()
    }

    /// 检查播放是否已结束
    pub fn is_finished(&self) -> bool {
        match (&self.shared, &self.sink) {
            (Some(shared), Some(sink)) => shared.is_done() && sink.empty(),
            _ => false,
        }
    }
}
