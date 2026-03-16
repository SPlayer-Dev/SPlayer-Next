use std::collections::VecDeque;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};

use crate::decoder::{self, AudioMetadata, Shared};
use crate::fft::FftAnalyzer;

/// 渐变步数
const FADE_STEPS: u32 = 20;

/// 在 `from` 和 `to` 之间线性渐变音量
fn fade_volume(sink: &Sink, from: f32, to: f32, duration_ms: u64) {
    if duration_ms == 0 {
        sink.set_volume(to);
        return;
    }
    let step_duration = Duration::from_millis(duration_ms / FADE_STEPS as u64);
    for i in 1..=FADE_STEPS {
        let t = i as f32 / FADE_STEPS as f32;
        sink.set_volume(from + (to - from) * t);
        std::thread::sleep(step_duration);
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
        // 快速路径：从本地缓冲返回
        if let Some(sample) = self.local_buffer.pop_front() {
            return Some(sample);
        }

        // 慢速路径：从共享缓冲区阻塞获取，跳过空数据块
        loop {
            let chunk = self.shared.pop()?;

            // 将 FFT 样本推送给分析器
            if !chunk.fft_samples.is_empty() {
                self.fft.push_samples(&chunk.fft_samples);
            }

            // 填充本地缓冲
            if !chunk.player_samples.is_empty() {
                self.local_buffer.extend(chunk.player_samples);
                return self.local_buffer.pop_front();
            }
            // 空数据块（重采样器预热期），继续获取下一个
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
    sink: Option<Sink>,
    shared: Option<Arc<Shared>>,
    /// 解码线程句柄，stop 时 join 确保线程清理
    decoder_thread: Option<JoinHandle<()>>,
    fft: Arc<FftAnalyzer>,
    metadata: Option<AudioMetadata>,
    state: PlayerState,
    /// 播放位置基准（秒）
    position_base: f64,
    /// 播放起始时刻（用于计算实时位置）
    play_start: Option<Instant>,
    /// 当前音频源路径/地址
    current_source: Option<String>,
    /// 用户设置的目标音量（fade 期间 sink 音量会变化，需要记住目标值）
    target_volume: f32,
    /// 渐变时长（毫秒），0 表示禁用
    fade_duration_ms: u64,
    /// 封面缓存目录
    cover_cache_dir: Option<String>,
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
            position_base: 0.0,
            play_start: None,
            current_source: None,
            target_volume: 1.0,
            fade_duration_ms: 200,
            cover_cache_dir: None,
        })
    }

    /// 设置封面缓存目录
    pub fn set_cover_cache_dir(&mut self, dir: String) {
        self.cover_cache_dir = Some(dir);
    }

    /// 加载并播放音频源（本地路径或网络地址）
    pub fn load(&mut self, source: &str) -> Result<AudioMetadata> {
        self.stop_internal();
        self.fft.reset();

        let shared = Shared::new();
        let (metadata, handle) = decoder::start_decode(
            source,
            Arc::clone(&shared),
            self.cover_cache_dir.as_deref(),
        )?;

        let sink = Sink::try_new(&self.stream_handle).context("Failed to create audio sink")?;

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
        self.position_base = 0.0;
        self.play_start = Some(Instant::now());
        self.current_source = Some(source.to_string());

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
                    self.play_start = Some(Instant::now());
                    self.state = PlayerState::Playing;
                    fade_volume(sink, 0.0, self.target_volume, self.fade_duration_ms);
                }
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

    /// 暂停播放（渐出后暂停）
    pub fn pause(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }
        if let Some(ref sink) = self.sink {
            fade_volume(sink, self.target_volume, 0.0, self.fade_duration_ms);
            sink.pause();
            sink.set_volume(self.target_volume);
            if let Some(start) = self.play_start.take() {
                self.position_base += start.elapsed().as_secs_f64();
            }
            self.state = PlayerState::Paused;
        }
    }

    /// 停止播放并释放资源
    pub fn stop(&mut self) {
        self.stop_internal();
        self.state = PlayerState::Stopped;
    }

    fn stop_internal(&mut self) {
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
        self.play_start = None;
        self.position_base = 0.0;
    }

    /// 跳转到指定位置（秒）
    pub fn seek(&mut self, position_secs: f64) -> Result<()> {
        let source = self.current_source.clone().context("No source loaded")?;

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
        let shared = Shared::new();
        let shared_for_thread = Arc::clone(&shared);

        let source_clone = source;
        let handle = std::thread::spawn(move || {
            let _ = decoder::seek_decode(&source_clone, position_secs, &shared_for_thread);
        });

        let sink = Sink::try_new(&self.stream_handle).context("Failed to create audio sink")?;

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
        self.position_base = position_secs;
        self.play_start = Some(Instant::now());
        self.state = PlayerState::Playing;

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

    /// 获取当前播放位置（秒）
    pub fn position(&self) -> f64 {
        match (self.state, self.play_start) {
            (PlayerState::Playing, Some(start)) => {
                self.position_base + start.elapsed().as_secs_f64()
            }
            _ => self.position_base,
        }
    }

    /// 获取总时长（秒）
    pub fn duration(&self) -> f64 {
        self.metadata
            .as_ref()
            .map(|m| m.duration_secs)
            .unwrap_or(0.0)
    }

    /// 获取当前播放状态
    pub fn state(&self) -> PlayerState {
        self.state
    }

    /// 获取 FFT 频谱数据（128 个频段）
    pub fn fft_data(&self) -> Vec<f32> {
        self.fft.analyze()
    }

    /// 检查播放是否已结束
    pub fn is_finished(&self) -> bool {
        match (&self.shared, &self.sink) {
            (Some(shared), Some(sink)) => shared.is_done() && sink.empty(),
            _ => false,
        }
    }
}
