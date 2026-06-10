use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::{Condvar, Mutex};

use crate::metadata::ExternalLyric;

/// 解码后的 PCM 音频数据块
pub struct AudioChunk {
    /// 交错排列的 f32 播放样本（L R L R ...）
    pub player_samples: Vec<f32>,
    /// 单声道 f32 样本，用于 FFT 频谱分析
    pub fft_samples: Vec<f32>,
}

/// 解码线程与播放迭代器之间的共享状态
pub struct Shared {
    buffer: Mutex<VecDeque<AudioChunk>>,
    condvar: Condvar,
    is_eof: AtomicBool,
    is_stopping: AtomicBool,
    /// 已被 rodio 消费的交错采样数（含所有声道，即 stereo 时每帧 +2）
    samples_consumed: AtomicU64,
    /// 输出采样率（创建时确定，不可变）
    sample_rate: u32,
    /// 输出声道数（创建时确定，不可变）
    channels: u16,
    /// 所有数据已被消费完毕（DecoderSource 返回 None 时设置）
    /// 比 is_done() 更准确：is_done 只表示缓冲区空，all_consumed 表示 rodio 侧已消费完
    all_consumed: AtomicBool,
    /// 解码线程因读取失败（网络中断 / URL 失效）中止，区别于正常 EOF
    decode_failed: AtomicBool,
    /// 音量归一化增益因子（线性值，1.0 = 无增益）
    /// 使用 AtomicU32 + f32::to_bits/from_bits 实现原子 f32
    normalization_gain: AtomicU32,
    /// 音量归一化开关
    normalization_enabled: AtomicBool,
    /// 关联的 ffmpeg 中断标志（由 decoder::start_decode 在打开输入后注入）
    /// stop() 触发时一并设为 true，让正在阻塞的 ffmpeg IO 立即返回 AVERROR_EXIT
    /// 否则 packets().next() 这种同步调用要等到 rw_timeout（15s）才能感知 stop
    interrupt_flag: Mutex<Option<Arc<AtomicBool>>>,
}

/// 共享缓冲区最大容量（背压阈值）
pub const FRAME_BUFFER_CAPACITY: usize = 64;

impl Shared {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        assert!(
            sample_rate > 0 && channels > 0,
            "sample_rate/channels 必须为正"
        );
        Arc::new(Self {
            buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            condvar: Condvar::new(),
            is_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
            samples_consumed: AtomicU64::new(0),
            sample_rate,
            channels,
            all_consumed: AtomicBool::new(false),
            decode_failed: AtomicBool::new(false),
            normalization_gain: AtomicU32::new(1.0_f32.to_bits()),
            normalization_enabled: AtomicBool::new(false),
            interrupt_flag: Mutex::new(None),
        })
    }

    /// 绑定 ffmpeg 中断标志：start_decode 在打开输入后调用一次
    /// 之后任意线程调用 stop() 都会一并 set 这个标志，触发 ffmpeg 中断回调
    pub fn bind_interrupt(&self, flag: Arc<AtomicBool>) {
        *self.interrupt_flag.lock() = Some(flag);
    }

    /// 设置归一化增益因子（线性值）
    pub fn set_normalization_gain(&self, gain: f32) {
        self.normalization_gain
            .store(gain.to_bits(), Ordering::Relaxed);
    }

    /// 设置归一化开关
    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.normalization_enabled.store(enabled, Ordering::Relaxed);
    }

    /// 归一化是否启用
    pub fn is_normalization_enabled(&self) -> bool {
        self.normalization_enabled.load(Ordering::Relaxed)
    }

    /// 获取原始增益值（不考虑开关）
    pub fn normalization_gain(&self) -> f32 {
        f32::from_bits(self.normalization_gain.load(Ordering::Relaxed))
    }

    /// 批量累加已消费的采样数（由 DecoderSource 按 chunk 调用）
    pub fn advance_consumed(&self, count: u64) {
        self.samples_consumed.fetch_add(count, Ordering::Relaxed);
    }

    /// 已消费采样的原始计数（用于停滞检测，不做单位换算）
    pub fn samples_consumed_count(&self) -> u64 {
        self.samples_consumed.load(Ordering::Relaxed)
    }

    /// 缓冲区是否为空（true 表示解码 underrun，sink 不消费可能是正常等待数据）
    pub fn is_buffer_empty(&self) -> bool {
        self.buffer.lock().is_empty()
    }

    /// 标记所有数据已被消费完毕（DecoderSource 迭代结束时调用）
    /// stop 引发的迭代结束不算播放完成，否则 position timer 在停止窗口期
    /// 会把切歌/停止误报成 Ended，导致前端队列跳两首
    pub fn mark_all_consumed(&self) {
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        self.all_consumed.store(true, Ordering::Release);
    }

    /// 是否已收到停止信号
    pub fn is_stopping(&self) -> bool {
        self.is_stopping.load(Ordering::Acquire)
    }

    /// 检查是否所有数据已被 rodio 消费完毕
    pub fn is_all_consumed(&self) -> bool {
        self.all_consumed.load(Ordering::Acquire)
    }

    /// 标记解码因读取失败中止（网络中断 / URL 失效）
    pub fn mark_decode_failed(&self) {
        self.decode_failed.store(true, Ordering::Release);
    }

    /// 解码是否因读取失败中止
    pub fn is_decode_failed(&self) -> bool {
        self.decode_failed.load(Ordering::Acquire)
    }

    /// 基于实际消费采样数的精确播放位置（秒）
    pub fn consumed_position(&self) -> f64 {
        let samples = self.samples_consumed.load(Ordering::Relaxed);
        samples as f64 / self.sample_rate as f64 / self.channels as f64
    }

    /// 阻塞等待缓冲区有空间或收到停止信号，返回 false 表示应停止
    pub fn wait_for_space(&self) -> bool {
        let mut buf = self.buffer.lock();
        while buf.len() >= FRAME_BUFFER_CAPACITY && !self.is_stopping.load(Ordering::Acquire) {
            self.condvar.wait(&mut buf);
        }
        !self.is_stopping.load(Ordering::Acquire)
    }

    /// 推入数据块，缓冲区满时阻塞等待（背压）
    pub fn push(&self, chunk: AudioChunk) {
        let mut buf = self.buffer.lock();
        while buf.len() >= FRAME_BUFFER_CAPACITY && !self.is_stopping.load(Ordering::Acquire) {
            self.condvar.wait(&mut buf);
        }
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        buf.push_back(chunk);
        self.condvar.notify_one();
    }

    /// 弹出数据块，缓冲区空时阻塞等待。
    /// 仅在 EOF 或停止且缓冲区为空时返回 None。
    pub fn pop(&self) -> Option<AudioChunk> {
        let mut buf = self.buffer.lock();
        loop {
            if let Some(chunk) = buf.pop_front() {
                self.condvar.notify_one();
                return Some(chunk);
            }
            if self.is_eof.load(Ordering::Acquire) || self.is_stopping.load(Ordering::Acquire) {
                return None;
            }
            self.condvar.wait(&mut buf);
        }
    }

    /// 标记解码完成
    pub fn mark_eof(&self) {
        self.is_eof.store(true, Ordering::Release);
        self.condvar.notify_all();
    }

    /// 发出停止信号，唤醒双方
    /// 同时设置 ffmpeg 中断标志，让阻塞中的 IO（HTTP read 等）立即返回 AVERROR_EXIT
    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        if let Some(flag) = self.interrupt_flag.lock().as_ref() {
            flag.store(true, Ordering::Release);
        }
        self.condvar.notify_all();
    }

    /// 清空缓冲区并释放内存（stop 后调用，避免 AudioChunk 在 Arc 引用存活期间持续占用内存）
    pub fn drain_buffer(&self) {
        let mut buf = self.buffer.lock();
        buf.clear();
        buf.shrink_to_fit();
    }

    /// 检查播放是否已结束（EOF 且缓冲区为空）
    pub fn is_done(&self) -> bool {
        let buf = self.buffer.lock();
        self.is_eof.load(Ordering::Acquire) && buf.is_empty()
    }
}

/// 音频元数据（包含封面路径和歌词）
#[derive(Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    pub duration_secs: f64,
    /// 播放采样率（重采样后，用于音频输出）
    pub sample_rate: u32,
    pub channels: u16,
    /// 原始采样率（解码前，用于前端显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式名称（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词
    pub embedded_lyric: Option<String>,
    /// 同目录所有歌词文件
    pub external_lyrics: Vec<ExternalLyric>,
    /// 封面缩略图缓存路径（用于前端日常显示）
    pub cover: Option<String>,
    /// 原始封面数据（load 时一次性提取，供 SMTC 等使用，避免重复打开文件）
    pub cover_raw: Option<Vec<u8>>,
}
