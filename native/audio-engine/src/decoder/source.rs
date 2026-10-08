use std::sync::Arc;

use crate::decoder::buffer::{PopResult, Shared};

/// 平台无关的解码样本读取器。
/// DSP 已在后台线程完成；这里不获取 DSP 锁、不扩容，欠载时只补齐当前回调。
/// 所有平台的 CPAL 输出回调都从该读取器拉取样本。
pub struct DecoderSampleReader {
    shared: Arc<Shared>,
    /// DSP 后样本缓冲，直接接管 chunk 的 Vec，不复制也不扩容
    local_buffer: Vec<f32>,
    local_index: usize,
    local_source_samples: u64,
    reported_source_samples: u64,
    end_sample: u64,
    /// 欠载只补齐当前设备回调，下一次回调立即重新检查数据。
    underrun: bool,
    started: bool,
}

impl DecoderSampleReader {
    pub fn new(shared: Arc<Shared>) -> Self {
        Self {
            end_sample: shared.end_sample(),
            shared,
            local_buffer: Vec::new(),
            local_index: 0,
            local_source_samples: 0,
            reported_source_samples: 0,
            underrun: false,
            started: false,
        }
    }

    /// 每次设备请求新缓冲时解除欠载，避免静音跨越多个回调。
    pub fn begin_callback(&mut self) {
        self.sync_position();
        self.end_sample = self.shared.end_sample();
        self.started = self.started || self.shared.output_ready();
        self.underrun = !self.started;
    }

    pub fn is_underrun(&self) -> bool {
        self.underrun
    }

    /// 按实际取出的输出样本映射源位置，每个回调批量发布，避免逐样本原子写入
    pub fn sync_position(&mut self) {
        if self.local_buffer.is_empty() {
            return;
        }
        let consumed =
            self.local_source_samples * self.local_index as u64 / self.local_buffer.len() as u64;
        self.shared
            .advance_consumed(consumed - self.reported_source_samples);
        self.reported_source_samples = consumed;
    }
}

impl Iterator for DecoderSampleReader {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.end_sample != u64::MAX
            && self.local_index % usize::from(self.shared.channels()) == 0
        {
            let pending = if self.local_buffer.is_empty() {
                0
            } else {
                self.local_source_samples * self.local_index as u64 / self.local_buffer.len() as u64
                    - self.reported_source_samples
            };
            if self.shared.samples_consumed_count() + pending >= self.end_sample {
                self.sync_position();
                self.shared.mark_all_consumed();
                return None;
            }
        }
        if let Some(sample) = self.local_buffer.get(self.local_index).copied() {
            self.local_index += 1;
            return Some(sample);
        }
        if !self.local_buffer.is_empty() {
            self.sync_position();
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
                PopResult::Chunk(mut chunk) => {
                    self.shared
                        .recycle_fft_buffer(std::mem::take(&mut chunk.fft_samples));

                    if !chunk.player_samples.is_empty() {
                        self.local_source_samples = chunk.source_sample_count;
                        self.reported_source_samples = 0;
                        self.local_buffer = chunk.player_samples;
                        self.local_index = 1;
                        return self.local_buffer.first().copied();
                    }
                    self.shared.advance_consumed(chunk.source_sample_count);
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
