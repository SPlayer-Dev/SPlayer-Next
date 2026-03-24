use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink};

use crate::decoder;
use crate::fft::FftAnalyzer;
use crate::shared::{AudioMetadata, Shared};
use crate::source::DecoderSource;

/// 播放器推送给 JS 侧的事件类型
#[derive(Clone, Debug)]
pub enum PlayerEvent {
    /// 状态变化（playing / paused / stopped / idle）
    StateChanged { state: &'static str },
    /// 播放结束
    Ended,
    /// 位置更新（秒）—— 由内部定时器推送
    Position { position: f64, duration: f64 },
    /// FFT 频谱数据推送
    FftData { data: Vec<f32> },
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
    /// 解码线程句柄，join 后可回收 DecoderData 复用于 seek
    decoder_thread: Option<JoinHandle<decoder::DecoderData>>,
    fft: Arc<FftAnalyzer>,
    metadata: Option<AudioMetadata>,
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
    /// 事件回调（由 lib.rs 设置，内部转发到 JS ThreadsafeFunction）
    event_callback: Option<EventEmitter>,
    /// 位置推送定时器的停止信号
    position_timer_stop: Option<Arc<AtomicBool>>,
    /// 渐变取消信号（快速连续 play/pause 时取消上一次渐变）
    fade_cancel: Option<Arc<AtomicBool>>,
    /// FFT 推送开关（前端需要显示频谱时才启用）
    fft_enabled: Arc<AtomicBool>,
    /// FFT 推送定时器的停止信号
    fft_timer_stop: Option<Arc<AtomicBool>>,
    /// 用户选择的输出设备名称（None = 系统默认）
    selected_device_name: Option<String>,
}

impl InnerPlayer {
    /// 根据选择的设备名称构建音频输出流
    fn build_output_stream(
        device_name: &Option<String>,
    ) -> Result<(OutputStream, OutputStreamHandle)> {
        match device_name {
            Some(name) => {
                let host = cpal::default_host();
                let device = host
                    .output_devices()
                    .context("Failed to enumerate output devices")?
                    .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
                    .with_context(|| format!("Output device '{}' not found", name))?;
                OutputStream::try_from_device(&device).context("Failed to open named output device")
            }
            None => OutputStream::try_default().context("Failed to open default output device"),
        }
    }

    pub fn new() -> Result<Self> {
        let (stream, stream_handle) = Self::build_output_stream(&None)?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink: None,
            shared: None,
            decoder_thread: None,
            fft: Arc::new(FftAnalyzer::new(decoder::FFT_SAMPLE_RATE)),
            metadata: None,
            cover_raw: None,
            state: PlayerState::Idle,
            seek_base: 0.0,
            current_source: None,
            target_volume: 1.0,
            fade_duration_ms: 200,
            cover_cache_dir: None,
            event_callback: None,
            position_timer_stop: None,
            fade_cancel: None,
            fft_enabled: Arc::new(AtomicBool::new(false)),
            fft_timer_stop: None,
            selected_device_name: None,
        })
    }

    /// 获取所有输出设备列表
    pub fn get_output_devices() -> Vec<(String, bool)> {
        let host = cpal::default_host();
        let default_name = host.default_output_device().and_then(|d| d.name().ok());

        host.output_devices()
            .map(|devices| {
                devices
                    .filter_map(|d| {
                        let name = d.name().ok()?;
                        let is_default = default_name.as_ref() == Some(&name);
                        Some((name, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 获取系统默认输出设备名称
    pub fn get_default_device_name() -> Option<String> {
        cpal::default_host()
            .default_output_device()
            .and_then(|d| d.name().ok())
    }

    /// 切换输出设备（None = 系统默认）
    pub fn set_output_device(&mut self, device_name: Option<String>) -> Result<()> {
        self.selected_device_name = device_name;
        self.reinit_output()
    }

    /// 获取当前选择的输出设备名称（None = 系统默认）
    pub fn selected_device_name(&self) -> Option<&str> {
        self.selected_device_name.as_deref()
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

    /// 启动 FFT 推送定时器（独立线程，每 50ms 推送一次频谱数据）
    fn start_fft_timer(&mut self) {
        self.stop_fft_timer();

        let stop_flag = Arc::new(AtomicBool::new(false));
        self.fft_timer_stop = Some(Arc::clone(&stop_flag));

        let fft_enabled = Arc::clone(&self.fft_enabled);
        let fft = Arc::clone(&self.fft);
        let cb = match &self.event_callback {
            Some(cb) => Arc::clone(cb),
            None => return,
        };

        thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                if fft_enabled.load(Ordering::Relaxed) {
                    let data = fft.analyze();
                    cb(PlayerEvent::FftData { data });
                }
                thread::sleep(Duration::from_millis(50));
            }
        });
    }

    /// 停止 FFT 推送定时器
    fn stop_fft_timer(&mut self) {
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// 设置 FFT 推送开关
    pub fn set_fft_enabled(&mut self, enabled: bool) {
        self.fft_enabled.store(enabled, Ordering::Relaxed);
    }

    /// 获取 FFT 推送开关状态
    pub fn fft_enabled(&self) -> bool {
        self.fft_enabled.load(Ordering::Relaxed)
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

        // 重建音频输出（使用用户选择的设备或系统默认）
        let (stream, stream_handle) = Self::build_output_stream(&self.selected_device_name)?;
        self._stream = stream;
        self.stream_handle = stream_handle;

        // 恢复播放状态
        match prev_state {
            PlayerState::Playing | PlayerState::Paused => {
                if let Some(source) = prev_source {
                    // 先以暂停模式加载，避免 seek 前播出开头片段
                    self.load(&source, false)?;
                    if prev_position > 0.5 {
                        self.seek(prev_position)?;
                    }
                    self.set_volume(prev_volume);
                    // 恢复到原来的播放/暂停状态
                    if prev_state == PlayerState::Playing {
                        self.play()?;
                    }
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

    /// 只读取元数据，不启动解码和播放
    pub fn probe(&self, source: &str) -> Result<AudioMetadata> {
        decoder::probe_metadata(source, self.cover_cache_dir.as_deref())
    }

    /// 加载音频源，auto_play 控制是否自动播放
    pub fn load(&mut self, source: &str, auto_play: bool) -> Result<AudioMetadata> {
        self.stop_internal();
        self.fft.reset();

        let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
        let (mut metadata, handle) =
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
        // 不自动播放时先暂停 sink，再 append，确保没有任何声音输出
        if !auto_play {
            sink.pause();
        }
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.seek_base = 0.0;
        self.current_source = Some(source.to_string());

        // 将 cover_raw 从 metadata 中取出缓存，避免 clone 时复制大量封面数据
        self.cover_raw = metadata.cover_raw.take();
        let result = metadata.clone();
        self.metadata = Some(metadata);

        if auto_play {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged { state: "playing" });
            self.start_position_timer();
            self.start_fft_timer();
        } else {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged { state: "paused" });
        }

        Ok(result)
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
                self.start_fft_timer();

                // 非阻塞渐入
                self.start_fade(0.0, self.target_volume, None);
            }
            // 停止/空闲/播放结束：从头重新加载
            PlayerState::Stopped | PlayerState::Idle => {
                if let Some(source) = self.current_source.clone() {
                    self.load(&source, true)?;
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
        self.stop_fft_timer();
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
        self.stop_fft_timer();
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
        self.cover_raw = None;
        self.metadata = None;
        self.seek_base = 0.0;
    }

    /// 跳转到指定位置（秒）
    ///
    /// 回收解码线程中的 DecoderData 并复用（seek + flush），不重建 FFmpeg 上下文。
    /// 仅在回收失败时回退到完整 load。
    pub fn seek(&mut self, position_secs: f64) -> Result<()> {
        self.cancel_fade();
        self.stop_position_timer();
        self.stop_fft_timer();

        // 停止当前解码线程并回收 DecoderData
        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let mut decoder_data = self.decoder_thread.take().and_then(|h| h.join().ok());

        self.fft.reset();

        // 在已有上下文上 seek（不重新打开文件）
        let seek_ok = decoder_data
            .as_mut()
            .map(|d| d.seek(position_secs).is_ok())
            .unwrap_or(false);

        if !seek_ok {
            // 回收失败（线程 panic 或 seek 出错），回退到从头 load，不再递归 seek
            drop(decoder_data);
            if let Some(source) = self.current_source.clone() {
                self.load(&source, true)?;
            }
            return Ok(());
        }

        let decoder_data = decoder_data.unwrap();

        // 创建新的共享状态（旧的 is_stopping=true 不可复用）
        let shared = Shared::new(decoder::TARGET_SAMPLE_RATE, decoder::TARGET_CHANNELS);
        let handle = decoder::resume_decode(decoder_data, Arc::clone(&shared));

        let sink =
            Arc::new(Sink::try_new(&self.stream_handle).context("Failed to create audio sink")?);

        let metadata = self.metadata.as_ref().context("No metadata available")?;
        let decoder_source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::clone(&self.fft),
            metadata.sample_rate,
            metadata.channels,
        );

        // 保持 seek 前的播放/暂停状态
        let was_paused = self.state == PlayerState::Paused;
        sink.set_volume(self.target_volume);
        if was_paused {
            sink.pause();
        }
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.seek_base = position_secs;

        if was_paused {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged { state: "paused" });
        } else {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged { state: "playing" });
            self.start_position_timer();
            self.start_fft_timer();
        }

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

    /// 获取缓存的原始封面数据（load 时一次性提取）
    pub fn cover_raw(&self) -> Option<&[u8]> {
        self.cover_raw.as_deref()
    }

    /// 检查播放是否已结束
    pub fn is_finished(&self) -> bool {
        match (&self.shared, &self.sink) {
            (Some(shared), Some(sink)) => shared.is_done() && sink.empty(),
            _ => false,
        }
    }
}
