use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};

use crate::http_source::HttpInterrupt;
use crate::metadata::ExternalLyric;
use parking_lot::{Condvar, Mutex};

/// 解码后的 PCM 音频数据块
pub struct AudioChunk {
    /// 交错排列的 f32 播放样本（L R L R ...）
    pub player_samples: Vec<f32>,
}

/// 非阻塞弹出缓冲区的结果
pub enum PopResult {
    Chunk(AudioChunk),
    Pending,
    Finished,
}

const DECODE_RUNNING: u8 = 0;
const DECODE_EOF: u8 = 1;
const DECODE_FAILED: u8 = 2;
const DECODE_INTERNAL_FAILED: u8 = 3;

/// 解码线程与播放迭代器之间的共享状态
pub struct Shared {
    buffer: Mutex<VecDeque<AudioChunk>>,
    /// 解码输出块回收池，只在 decoder/DSP 工作线程间使用，避免每个 FFmpeg frame 重新分配。
    recycled_buffers: Mutex<Vec<Vec<f32>>>,
    condvar: Condvar,
    decode_state: AtomicU8,
    is_stopping: AtomicBool,
    /// 输出采样率（创建时确定，不可变）
    sample_rate: u32,
    /// 解码线程因读取失败（网络中断 / URL 失效）中止，区别于正常 EOF
    /// 音量归一化增益因子（线性值，1.0 = 无增益）
    /// 使用 AtomicU32 + f32::to_bits/from_bits 实现原子 f32
    normalization_gain: AtomicU32,
    /// 音量归一化开关
    normalization_enabled: AtomicBool,
    /// 关联的网络中断句柄（由 decoder 在启动解码前注入）
    /// stop() 触发时中断读取和重试等待，seek 前可重置
    interrupt: Mutex<Option<HttpInterrupt>>,
}

/// 共享缓冲区最大容量（背压阈值）
pub const FRAME_BUFFER_CAPACITY: usize = 192;

impl Shared {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        assert!(
            sample_rate > 0 && channels > 0,
            "sample_rate/channels 必须为正"
        );
        Arc::new(Self {
            buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            recycled_buffers: Mutex::new(Vec::with_capacity(4)),
            condvar: Condvar::new(),
            decode_state: AtomicU8::new(DECODE_RUNNING),
            is_stopping: AtomicBool::new(false),
            sample_rate,
            normalization_gain: AtomicU32::new(1.0_f32.to_bits()),
            normalization_enabled: AtomicBool::new(false),
            interrupt: Mutex::new(None),
        })
    }

    /// 绑定网络中断句柄，之后调用 stop() 会中断 HTTP IO
    pub fn bind_interrupt(&self, interrupt: HttpInterrupt) {
        *self.interrupt.lock() = Some(interrupt);
    }

    /// 设置归一化增益因子（线性值）
    pub fn set_normalization_gain(&self, gain: f32) {
        self.normalization_gain
            .store(gain.to_bits(), Ordering::Relaxed);
    }

    /// 输出采样率
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
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

    /// 缓冲区是否为空（true 表示解码 underrun，sink 不消费可能是正常等待数据）
    pub fn is_buffer_empty(&self) -> bool {
        self.buffer.lock().is_empty()
    }

    /// 当前等待 DSP 消费的解码块数，仅用于低频诊断快照。
    pub fn buffered_chunks(&self) -> usize {
        self.buffer.lock().len()
    }

    /// 是否已收到停止信号
    pub fn is_stopping(&self) -> bool {
        self.is_stopping.load(Ordering::Acquire)
    }

    /// 标记解码因读取失败中止（网络中断 / URL 失效）
    pub fn mark_decode_failed(&self) {
        self.decode_state.store(DECODE_FAILED, Ordering::Release);
        self.condvar.notify_all();
    }

    /// 标记解码器发生 panic 等内部故障；此状态不得被当作正常 EOF。
    pub fn mark_internal_failed(&self) {
        self.decode_state
            .store(DECODE_INTERNAL_FAILED, Ordering::Release);
        self.condvar.notify_all();
    }

    /// 解码是否因读取失败中止
    pub fn is_decode_failed(&self) -> bool {
        self.decode_state.load(Ordering::Acquire) == DECODE_FAILED
    }

    /// 解码器是否因内部故障停止。
    pub fn is_internal_failed(&self) -> bool {
        self.decode_state.load(Ordering::Acquire) == DECODE_INTERNAL_FAILED
    }

    /// 取得一个可复用 PCM 缓冲。回收池为空时才分配新的 Vec header/buffer。
    pub fn take_recycled_buffer(&self) -> Vec<f32> {
        self.recycled_buffers.lock().pop().unwrap_or_default()
    }

    /// 回收已清空的 PCM 缓冲，并限制池大小和单块高水位，避免异常帧永久抬高常驻内存。
    pub fn recycle_buffer(&self, mut buffer: Vec<f32>) {
        const MAX_RECYCLED_BUFFERS: usize = 4;
        const MAX_RECYCLED_SAMPLES: usize = 1_048_576;
        if buffer.capacity() > MAX_RECYCLED_SAMPLES {
            return;
        }
        buffer.clear();
        let mut recycled = self.recycled_buffers.lock();
        if recycled.len() < MAX_RECYCLED_BUFFERS {
            recycled.push(buffer);
        }
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

    /// 非阻塞弹出数据块，供实时输出线程避免在音频回调链路里等待解码线程
    pub fn try_pop(&self) -> PopResult {
        let mut buf = self.buffer.lock();
        if let Some(chunk) = buf.pop_front() {
            self.condvar.notify_one();
            return PopResult::Chunk(chunk);
        }
        if self.decode_state.load(Ordering::Acquire) != DECODE_RUNNING
            || self.is_stopping.load(Ordering::Acquire)
        {
            PopResult::Finished
        } else {
            PopResult::Pending
        }
    }

    /// 标记解码完成
    pub fn mark_eof(&self) {
        let _ = self.decode_state.compare_exchange(
            DECODE_RUNNING,
            DECODE_EOF,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        self.condvar.notify_all();
    }

    /// 发出停止信号，唤醒双方
    /// 同时取消网络请求，让阻塞中的 HTTP IO 尽快返回
    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        if let Some(interrupt) = self.interrupt.lock().as_ref() {
            interrupt.cancel();
        }
        self.condvar.notify_all();
    }

    /// 清空缓冲区并释放内存（stop 后调用，避免 AudioChunk 在 Arc 引用存活期间持续占用内存）
    pub fn drain_buffer(&self) {
        let mut buf = self.buffer.lock();
        buf.clear();
        buf.shrink_to_fit();
        let mut recycled = self.recycled_buffers.lock();
        recycled.clear();
        recycled.shrink_to_fit();
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

#[cfg(test)]
mod tests {
    use super::{PopResult, Shared};

    #[test]
    fn decode_failure_terminates_empty_consumer() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();
        assert!(shared.is_decode_failed());
        assert!(matches!(shared.try_pop(), PopResult::Finished));
    }

    #[test]
    fn recycles_pcm_buffer_without_retaining_abnormal_capacity() {
        let shared = Shared::new(48_000, 2);
        let mut normal = Vec::with_capacity(4096);
        normal.extend_from_slice(&[1.0, 2.0]);
        shared.recycle_buffer(normal);
        assert!(shared.take_recycled_buffer().capacity() >= 4096);

        shared.recycle_buffer(Vec::with_capacity(1_048_577));
        assert_eq!(shared.take_recycled_buffer().capacity(), 0);
    }
}
