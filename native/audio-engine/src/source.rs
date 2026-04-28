use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::Source;

use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::shared::Shared;
use crate::tempo::StretchProcessor;

/// rodio 音频源，从共享缓冲区拉取样本。
/// 使用 condvar 阻塞等待数据，不会返回静音填充。
pub struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// 跨曲目共享的均衡器，load/seek 时通过 Arc::clone 传入
    equalizer: Arc<Mutex<Equalizer>>,
    /// 跨曲目共享的变速变调处理器，load/seek 时通过 Arc::clone 传入
    tempo: Arc<Mutex<StretchProcessor>>,
    /// 本地缓冲，减少锁竞争
    local_buffer: VecDeque<f32>,
    /// stretch 输出复用缓冲（避免每帧分配）
    tempo_scratch: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

impl DecoderSource {
    pub fn new(
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        equalizer: Arc<Mutex<Equalizer>>,
        tempo: Arc<Mutex<StretchProcessor>>,
        sample_rate: u32,
        channels: u16,
    ) -> Self {
        Self {
            shared,
            fft,
            equalizer,
            tempo,
            local_buffer: VecDeque::new(),
            tempo_scratch: Vec::new(),
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
                    let mut samples = chunk.player_samples;
                    // 对整 chunk 应用 EQ：每秒只锁 50~100 次，开销摊到几千个样本上
                    self.equalizer.lock().process_interleaved_stereo(&mut samples);
                    // 源时间长度（按输入计数，与 speed 无关；让 consumed_position 反映源进度）
                    let source_count = samples.len() as u64;
                    // 变速变调（bypass 时直接 extend，零开销）
                    self.tempo_scratch.clear();
                    self.tempo.lock().process(&samples, &mut self.tempo_scratch);
                    if !self.tempo_scratch.is_empty() {
                        self.local_buffer.extend(self.tempo_scratch.drain(..));
                    }
                    self.shared.advance_consumed(source_count);
                    // stretch 在预热期可能本帧没产出，没样本就继续拉下一块
                    let Some(s) = self.local_buffer.pop_front() else {
                        continue;
                    };
                    return Some(s);
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
