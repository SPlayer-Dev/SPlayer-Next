use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_queue::ArrayQueue;
use ffmpeg_audio::HttpCancelHandle;
use parking_lot::{Condvar, Mutex};

/// 解码后的 PCM 音频数据块
pub struct AudioChunk {
    /// 交错排列的 f32 播放样本（L R L R ...）
    pub player_samples: Vec<f32>,
    /// 交错排列的 f32 FFT 样本（L R L R ...）
    pub fft_samples: Vec<f32>,
    /// tempo 处理前的源样本数，用于保持变速时播放位置准确
    pub source_sample_count: u64,
}

/// 非阻塞弹出缓冲区的结果
pub enum PopResult {
    Chunk(AudioChunk),
    Pending,
    Finished,
}

/// 解码线程与播放迭代器之间的共享状态
pub struct Shared {
    decoded_buffer: Mutex<VecDeque<AudioChunk>>,
    decoded_condvar: Condvar,
    output_buffer: ArrayQueue<AudioChunk>,
    output_wait: Mutex<()>,
    output_samples: AtomicU64,
    underruns: AtomicU64,
    output_condvar: Condvar,
    player_buffer_pool: ArrayQueue<Vec<f32>>,
    fft_buffer_pool: ArrayQueue<Vec<f32>>,
    decode_eof: AtomicBool,
    output_eof: AtomicBool,
    is_stopping: AtomicBool,
    /// 已被输出回调消费的交错采样数（包含所有声道）
    samples_consumed: AtomicU64,
    /// 输出采样率（创建时确定，不可变）
    sample_rate: u32,
    /// 输出声道数（创建时确定，不可变）
    channels: u16,
    /// 所有数据已被消费完毕（DecoderSource 返回 None 时设置）
    /// 比 is_done() 更准确：is_done 只表示缓冲区空，all_consumed 表示输出回调已消费完
    all_consumed: AtomicBool,
    /// 解码线程因读取失败（网络中断 / URL 失效）中止，区别于正常 EOF
    decode_failed: AtomicBool,
    /// 音量归一化增益因子（线性值，1.0 = 无增益）
    /// 使用 AtomicU32 + f32::to_bits/from_bits 实现原子 f32
    normalization_gain: AtomicU32,
    /// 音量归一化开关
    normalization_enabled: AtomicBool,
    /// 关联的网络中断句柄（由 decoder 在启动解码前注入）
    /// stop() 触发时中断读取和重试等待，seek 前可重置
    cancel_handle: Mutex<Option<HttpCancelHandle>>,
}

/// 共享缓冲区最大容量（背压阈值）
pub const FRAME_BUFFER_CAPACITY: usize = 192;

/// 块数只限制元数据；正常背压按时长计算，避免高采样率缩短缓冲。
const OUTPUT_BUFFER_CAPACITY: usize = 256;
const OUTPUT_BUFFER_MS: u64 = 100;

/// 复用池上限覆盖解码队列、输出队列和两个线程的在手缓冲
const BUFFER_POOL_CAPACITY: usize = FRAME_BUFFER_CAPACITY + OUTPUT_BUFFER_CAPACITY + 4;

impl Shared {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        assert!(
            sample_rate > 0 && channels > 0,
            "sample_rate/channels 必须为正"
        );
        Arc::new(Self {
            decoded_buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            decoded_condvar: Condvar::new(),
            output_buffer: ArrayQueue::new(OUTPUT_BUFFER_CAPACITY),
            output_wait: Mutex::new(()),
            output_samples: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            output_condvar: Condvar::new(),
            player_buffer_pool: ArrayQueue::new(BUFFER_POOL_CAPACITY),
            fft_buffer_pool: ArrayQueue::new(BUFFER_POOL_CAPACITY),
            decode_eof: AtomicBool::new(false),
            output_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
            samples_consumed: AtomicU64::new(0),
            sample_rate,
            channels,
            all_consumed: AtomicBool::new(false),
            decode_failed: AtomicBool::new(false),
            normalization_gain: AtomicU32::new(1.0_f32.to_bits()),
            normalization_enabled: AtomicBool::new(false),
            cancel_handle: Mutex::new(None),
        })
    }

    /// 绑定网络中断句柄，之后调用 stop() 会中断 HTTP IO
    pub fn bind_cancel_handle(&self, cancel_handle: HttpCancelHandle) {
        *self.cancel_handle.lock() = Some(cancel_handle);
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

    /// 播放输出声道数
    pub fn channels(&self) -> u16 {
        self.channels
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

    /// 获取可复用的播放样本缓冲
    pub fn take_player_buffer(&self) -> Vec<f32> {
        self.player_buffer_pool.pop().unwrap_or_default()
    }

    /// 归还播放样本缓冲；池满时直接释放以保持内存有界
    pub fn recycle_player_buffer(&self, mut buffer: Vec<f32>) {
        buffer.clear();
        let _ = self.player_buffer_pool.push(buffer);
    }

    /// 获取可复用的 FFT 样本缓冲
    pub fn take_fft_buffer(&self) -> Vec<f32> {
        self.fft_buffer_pool.pop().unwrap_or_default()
    }

    /// 归还 FFT 样本缓冲；池满时直接释放以保持内存有界
    pub fn recycle_fft_buffer(&self, mut buffer: Vec<f32>) {
        buffer.clear();
        let _ = self.fft_buffer_pool.push(buffer);
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
        self.output_buffer.is_empty()
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

    /// 检查是否所有数据已被输出回调消费完毕
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
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        !self.is_stopping.load(Ordering::Acquire) && !self.output_eof.load(Ordering::Acquire)
    }

    /// 推入数据块，缓冲区满时阻塞等待（背压）
    pub fn push(&self, chunk: AudioChunk) {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        if self.is_stopping.load(Ordering::Acquire) || self.output_eof.load(Ordering::Acquire) {
            return;
        }
        buffer.push_back(chunk);
        self.decoded_condvar.notify_one();
    }

    /// 阻塞获取待处理块；解码结束且缓冲耗尽时返回 None
    pub fn pop_decoded(&self) -> Option<AudioChunk> {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.is_empty()
            && !self.decode_eof.load(Ordering::Acquire)
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        let chunk = buffer.pop_front();
        if chunk.is_some() {
            self.decoded_condvar.notify_one();
        }
        chunk
    }

    /// 按输出时长背压，最多超出一个解码块。
    pub fn push_output(&self, chunk: AudioChunk) {
        let limit =
            u64::from(self.sample_rate) * u64::from(self.channels) * OUTPUT_BUFFER_MS / 1000;
        let samples = chunk.player_samples.len() as u64;
        let mut pending = chunk;
        let mut wait = self.output_wait.lock();
        loop {
            if self.is_stopping.load(Ordering::Acquire) {
                return;
            }
            if self.output_samples.load(Ordering::Acquire) < limit {
                // 先计数再发布，避免消费者先弹出导致计数下溢。
                self.output_samples.fetch_add(samples, Ordering::AcqRel);
                match self.output_buffer.push(pending) {
                    Ok(()) => return,
                    Err(chunk) => pending = chunk,
                }
                self.output_samples.fetch_sub(samples, Ordering::AcqRel);
            }
            // 回调不持有等待锁，超时兜住检查条件与等待之间的通知竞态。
            self.output_condvar
                .wait_for(&mut wait, Duration::from_millis(2));
        }
    }

    /// 回调只累加计数，由低频状态线程记录欠载。
    pub fn record_underrun(&self) {
        self.underruns.fetch_add(1, Ordering::Relaxed);
    }

    pub fn take_underruns(&self) -> u64 {
        self.underruns.swap(0, Ordering::Relaxed)
    }

    /// 短曲和极小解码块不能因预缓冲阈值而无法开始消费。
    pub fn output_ready(&self) -> bool {
        self.output_samples.load(Ordering::Acquire)
            >= u64::from(self.sample_rate) * u64::from(self.channels) * 20 / 1000
            || self.output_eof.load(Ordering::Acquire)
            || self.output_buffer.is_full()
    }

    /// 非阻塞弹出数据块，供实时输出线程避免在音频回调链路里等待解码线程
    pub fn try_pop(&self) -> PopResult {
        // 必须先观察 EOF，再检查队列；反过来会漏掉刚发布的最后一块。
        let finished =
            self.output_eof.load(Ordering::Acquire) || self.is_stopping.load(Ordering::Acquire);
        if let Some(chunk) = self.output_buffer.pop() {
            self.output_samples
                .fetch_sub(chunk.player_samples.len() as u64, Ordering::AcqRel);
            self.output_condvar.notify_one();
            return PopResult::Chunk(chunk);
        }
        if finished {
            PopResult::Finished
        } else {
            PopResult::Pending
        }
    }

    /// 标记解码完成
    pub fn mark_eof(&self) {
        self.decode_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
    }

    /// 标记 DSP 已处理完全部输出
    pub fn mark_output_eof(&self) {
        self.output_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    /// 发出停止信号，唤醒双方
    /// 同时取消网络请求，让阻塞中的 HTTP IO 尽快返回
    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        if let Some(handle) = self.cancel_handle.lock().as_ref() {
            handle.cancel();
        }
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    /// 清空缓冲区并释放内存（stop 后调用，避免 AudioChunk 在 Arc 引用存活期间持续占用内存）
    pub fn drain_buffer(&self) {
        // 控制线程等待生产者退出发布区，避免停止后仍留下最后一块。
        let _output_guard = self.output_wait.lock();
        let mut decoded = self.decoded_buffer.lock();
        let decoded_chunks = std::mem::take(&mut *decoded);
        decoded.shrink_to_fit();
        drop(decoded);
        for chunk in decoded_chunks {
            self.recycle_player_buffer(chunk.player_samples);
            self.recycle_fft_buffer(chunk.fft_samples);
        }
        while let PopResult::Chunk(chunk) = self.try_pop() {
            self.recycle_player_buffer(chunk.player_samples);
            self.recycle_fft_buffer(chunk.fft_samples);
        }
    }
}

#[cfg(test)]
#[path = "tests/buffer.rs"]
mod tests;
