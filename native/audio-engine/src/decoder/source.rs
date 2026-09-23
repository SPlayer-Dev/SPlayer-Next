use std::sync::Arc;

use crate::decoder::buffer::{PopResult, Shared};
use crate::dsp::fft::FftAnalyzer;

/// 平台无关的解码样本读取器。
/// DSP 已在后台线程完成；这里不获取 DSP 锁、不扩容，欠载时只补齐当前回调。
/// 所有平台的 CPAL 输出回调都从该读取器拉取样本。
pub struct DecoderSampleReader {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// DSP 后样本缓冲，直接接管 chunk 的 Vec，不复制也不扩容
    local_buffer: Vec<f32>,
    local_index: usize,
    /// 欠载只补齐当前设备回调，下一次回调立即重新检查数据。
    underrun: bool,
    started: bool,
}

impl DecoderSampleReader {
    pub fn new(shared: Arc<Shared>, fft: Arc<FftAnalyzer>) -> Self {
        Self {
            shared,
            fft,
            local_buffer: Vec::new(),
            local_index: 0,
            underrun: false,
            started: false,
        }
    }

    /// 每次设备请求新缓冲时解除欠载，避免静音跨越多个回调。
    pub fn begin_callback(&mut self) {
        self.started = self.started || self.shared.output_ready();
        self.underrun = !self.started;
    }

    pub fn is_underrun(&self) -> bool {
        self.underrun
    }
}

impl Iterator for DecoderSampleReader {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if let Some(sample) = self.local_buffer.get(self.local_index).copied() {
            self.local_index += 1;
            return Some(sample);
        }
        if !self.local_buffer.is_empty() {
            self.shared
                .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
            self.local_index = 0;
        }
        if self.underrun {
            return Some(0.0);
        }

        // 慢速路径：从共享缓冲区非阻塞获取，跳过空数据块
        loop {
            match self.shared.try_pop() {
                // 将 FFT 样本推送给分析器
                PopResult::Chunk(mut chunk) => {
                    if self.fft.is_enabled() {
                        self.fft.push_interleaved_samples(&chunk.fft_samples);
                    }
                    self.shared
                        .recycle_fft_buffer(std::mem::take(&mut chunk.fft_samples));

                    self.shared.advance_consumed(chunk.source_sample_count);
                    if !chunk.player_samples.is_empty() {
                        self.local_buffer = chunk.player_samples;
                        self.local_index = 1;
                        return self.local_buffer.first().copied();
                    }
                    self.shared.recycle_player_buffer(chunk.player_samples);
                }
                PopResult::Pending => {
                    self.underrun = true;
                    self.shared.record_underrun();
                    return Some(0.0);
                }
                PopResult::Finished => {
                    // 数据源耗尽，标记消费完毕
                    self.shared.mark_all_consumed();
                    return None;
                }
            }
        }
    }
}

impl Drop for DecoderSampleReader {
    fn drop(&mut self) {
        self.shared
            .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
    }
}

/// 解码样本读取器别名，作为播放输出链路的输入类型
#[cfg(test)]
pub type DecoderSource = DecoderSampleReader;

#[cfg(test)]
#[path = "tests/source.rs"]
mod tests;
