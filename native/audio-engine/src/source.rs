use std::sync::Arc;
use std::time::Duration;

use rodio::{ChannelCount, SampleRate, Source};

use crate::fft::FftAnalyzer;
use crate::shared::{PopResult, Shared};
const UNDERRUN_SILENCE_MS: u32 = 20;

/// rodio 音频源，从共享缓冲区拉取样本。
/// DSP 已在后台线程完成；这里不获取 DSP 锁、不扩容，欠载时返回短静音垫片。
pub struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// DSP 后样本缓冲，直接接管 chunk 的 Vec，不复制也不扩容
    local_buffer: Vec<f32>,
    local_index: usize,
    /// 解码暂时跟不上时输出的短静音垫片，避免阻塞实时输出链路
    underrun_silence_remaining: usize,
    sample_rate: SampleRate,
    channels: ChannelCount,
}

impl DecoderSource {
    pub fn new(
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        sample_rate: u32,
        channels: u16,
    ) -> Self {
        Self {
            shared,
            fft,
            local_buffer: Vec::new(),
            local_index: 0,
            underrun_silence_remaining: 0,
            sample_rate: SampleRate::new(sample_rate).expect("采样率必须大于零"),
            channels: ChannelCount::new(channels).expect("声道数必须大于零"),
        }
    }
}

impl Iterator for DecoderSource {
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
        if self.underrun_silence_remaining > 0 {
            self.underrun_silence_remaining -= 1;
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
                    let silence_samples = (u64::from(self.sample_rate.get())
                        * u64::from(self.channels.get())
                        * u64::from(UNDERRUN_SILENCE_MS)
                        / 1000) as usize;
                    self.underrun_silence_remaining = silence_samples.saturating_sub(1);
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

impl Drop for DecoderSource {
    fn drop(&mut self) {
        self.shared
            .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
    }
}

impl Source for DecoderSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        self.channels
    }

    fn sample_rate(&self) -> SampleRate {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::AudioChunk;

    #[test]
    fn returns_preprocessed_samples_without_copying() {
        let shared = Shared::new(48_000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![0.1, -0.1, 2.0, -2.0],
            fft_samples: vec![],
            source_sample_count: 4,
        });

        let mut source = DecoderSource::new(shared, Arc::new(FftAnalyzer::new()), 48_000, 2);

        assert!((source.next().unwrap() - 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() + 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() - 2.0).abs() < 1e-6);
        assert!((source.next().unwrap() + 2.0).abs() < 1e-6);
    }

    #[test]
    fn position_uses_source_sample_count_after_tempo_processing() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![0.25, -0.25],
            fft_samples: vec![],
            source_sample_count: 8,
        });
        let mut source =
            DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()), 1000, 2);

        assert_eq!(source.next(), Some(0.25));
        assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
    }

    #[test]
    fn tempo_warmup_without_output_still_advances_source_position() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: Vec::new(),
            fft_samples: Vec::new(),
            source_sample_count: 8,
        });
        let mut source =
            DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()), 1000, 2);

        assert_eq!(source.next(), Some(0.0));
        assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
    }

    #[test]
    fn returns_short_silence_when_decoder_temporarily_underruns() {
        let shared = Shared::new(1000, 2);
        let mut source =
            DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()), 1000, 2);

        assert_eq!(source.next(), Some(0.0));
        shared.push_output(AudioChunk {
            player_samples: vec![0.25, -0.25],
            fft_samples: vec![],
            source_sample_count: 2,
        });
        for _ in 0..39 {
            assert_eq!(source.next(), Some(0.0));
        }
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(source.next(), Some(-0.25));
    }
}
