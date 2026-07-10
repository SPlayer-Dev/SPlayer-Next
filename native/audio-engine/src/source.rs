use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::Source;

use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::shared::{PopResult, Shared};
use crate::tempo::StretchProcessor;

struct BiquadHighPass {
    z1: f32,
    z2: f32,
}

impl BiquadHighPass {
    const fn new() -> Self {
        Self { z1: 0.0, z2: 0.0 }
    }

    fn process(&mut self, input: f32, cutoff: f32, sample_rate: u32) -> f32 {
        let cutoff = cutoff.clamp(10.0, 22_000.0);
        let omega = 2.0 * std::f32::consts::PI * cutoff / sample_rate as f32;
        let sin = omega.sin();
        let cos = omega.cos();
        let alpha = sin / 2.0;
        let a0 = 1.0 + alpha;
        let b0 = (1.0 + cos) * 0.5 / a0;
        let b1 = -(1.0 + cos) / a0;
        let b2 = (1.0 + cos) * 0.5 / a0;
        let a1 = -2.0 * cos / a0;
        let a2 = (1.0 - alpha) / a0;
        let output = input.mul_add(b0, self.z1);
        self.z1 = input.mul_add(b1, self.z2) - a1 * output;
        self.z2 = input * b2 - a2 * output;
        output
    }
}

const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;
const UNDERRUN_SILENCE_MS: u32 = 20;

struct OutputLimiter {
    gain: f32,
}

impl OutputLimiter {
    fn new() -> Self {
        Self { gain: 1.0 }
    }

    fn process(&mut self, samples: &mut [f32]) {
        for sample in samples {
            let peak = sample.abs();
            let target_gain = if peak > OUTPUT_CEILING {
                OUTPUT_CEILING / peak
            } else {
                1.0
            };
            if peak * self.gain >= OUTPUT_CEILING {
                self.gain = target_gain;
            } else {
                self.gain += (1.0 - self.gain) * LIMITER_RELEASE;
            }
            *sample *= self.gain;
            *sample = sample.clamp(-OUTPUT_CEILING, OUTPUT_CEILING);
        }
    }
}

/// rodio 音频源，从共享缓冲区拉取样本。
/// 使用非阻塞 try_pop；解码暂时跟不上时输出短静音垫片。
pub struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// 跨曲目共享的均衡器，load/seek 时通过 Arc::clone 传入
    equalizer: Arc<Mutex<Equalizer>>,
    /// 跨曲目共享的变速变调处理器，load/seek 时通过 Arc::clone 传入
    tempo: Arc<Mutex<StretchProcessor>>,
    /// 本地缓冲，减少锁竞争
    local_buffer: VecDeque<f32>,
    /// 当前输出批次对应的源采样数，按实际 yield 进度推进播放时钟
    batch_source_samples: u64,
    batch_output_samples: u64,
    batch_output_emitted: u64,
    batch_source_advanced: u64,
    /// stretch 预热未产出时累积的源采样数
    pending_source_samples: u64,
    /// stretch 输出复用缓冲（避免每帧分配）
    tempo_scratch: Vec<f32>,
    high_pass_left: BiquadHighPass,
    high_pass_right: BiquadHighPass,
    /// 解码暂时跟不上时输出的短静音垫片，避免阻塞实时输出链路
    underrun_silence_remaining: usize,
    limiter: OutputLimiter,
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
            batch_source_samples: 0,
            batch_output_samples: 0,
            batch_output_emitted: 0,
            batch_source_advanced: 0,
            pending_source_samples: 0,
            tempo_scratch: Vec::new(),
            high_pass_left: BiquadHighPass::new(),
            high_pass_right: BiquadHighPass::new(),
            underrun_silence_remaining: 0,
            limiter: OutputLimiter::new(),
            sample_rate,
            channels,
        }
    }

    fn advance_output_clock(&mut self) {
        if self.batch_output_samples == 0 {
            return;
        }
        self.batch_output_emitted += 1;
        let target =
            self.batch_source_samples * self.batch_output_emitted / self.batch_output_samples;
        let advance = target.saturating_sub(self.batch_source_advanced);
        if advance > 0 {
            self.shared.advance_consumed(advance);
            self.batch_source_advanced = target;
        }
        if self.batch_output_emitted == self.batch_output_samples {
            self.batch_source_samples = 0;
            self.batch_output_samples = 0;
            self.batch_output_emitted = 0;
            self.batch_source_advanced = 0;
        }
    }

    fn next_buffered_sample(&mut self) -> Option<f32> {
        let sample = self.local_buffer.pop_front()?;
        self.advance_output_clock();
        Some(sample)
    }

    fn apply_high_pass_automation(&mut self, samples: &mut [f32]) {
        let Some(plan) = self.shared.high_pass_automation() else {
            return;
        };
        if self.channels != 2 {
            return;
        }
        let base_samples = self.shared.samples_consumed_count();
        let mut completed = false;
        for (frame_index, frame) in samples.chunks_exact_mut(2).enumerate() {
            let consumed = base_samples + frame_index as u64 * 2;
            match plan.cutoff_at(consumed) {
                Some(cutoff) => {
                    frame[0] = self.high_pass_left.process(frame[0], cutoff, self.sample_rate);
                    frame[1] = self.high_pass_right.process(frame[1], cutoff, self.sample_rate);
                }
                None => {
                    // FadeIn 自动化已完成，后续帧不再经过高通，同一批内不处理
                    completed = true;
                    break;
                }
            }
        }
        if completed {
            self.shared.clear_high_pass_automation();
            // 滤波器历史清零，避免下次意外复用残留状态
            self.high_pass_left = BiquadHighPass::new();
            self.high_pass_right = BiquadHighPass::new();
        }
    }
}

impl Iterator for DecoderSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        // 快速路径：从本地缓冲返回（无原子操作）
        if let Some(sample) = self.next_buffered_sample() {
            return Some(sample);
        }
        if self.underrun_silence_remaining > 0 {
            self.underrun_silence_remaining -= 1;
            return Some(0.0);
        }

        // 慢速路径：从共享缓冲区非阻塞获取，跳过空数据块
        loop {
            match self.shared.try_pop() {
                PopResult::Chunk(chunk) => {
                    if !chunk.fft_samples.is_empty() {
                        self.fft.push_samples(&chunk.fft_samples);
                    }

                    // 填充本地缓冲，一次性批量计数（而非逐采样）
                    if !chunk.player_samples.is_empty() {
                        let mut samples = chunk.player_samples;
                        self.apply_high_pass_automation(&mut samples);
                        // 对整 chunk 应用 EQ：每秒只锁 50~100 次，开销摊到几千个样本上
                        self.equalizer
                            .lock()
                            .process_interleaved_stereo(&mut samples);
                        let source_count = samples.len() as u64;
                        self.pending_source_samples += source_count;
                        self.tempo_scratch.clear();
                        self.tempo.lock().process(&samples, &mut self.tempo_scratch);
                        if !self.tempo_scratch.is_empty() {
                            self.limiter.process(&mut self.tempo_scratch);
                            self.batch_source_samples = self.pending_source_samples;
                            self.batch_output_samples = self.tempo_scratch.len() as u64;
                            self.batch_output_emitted = 0;
                            self.batch_source_advanced = 0;
                            self.pending_source_samples = 0;
                            self.local_buffer.extend(self.tempo_scratch.drain(..));
                        }
                        let Some(sample) = self.next_buffered_sample() else {
                            continue;
                        };
                        return Some(sample);
                    }
                    // 空数据块（重采样器预热期），继续获取下一个
                }
                PopResult::Pending => {
                    let silence_samples = (u64::from(self.sample_rate)
                        * u64::from(self.channels)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::AudioChunk;

    #[test]
    fn limits_samples_after_equalizer_preamp() {
        let shared = Shared::new(48000, 2);
        shared.push(AudioChunk {
            player_samples: vec![0.8, -0.8],
            fft_samples: Vec::new(),
        });

        let equalizer = Arc::new(Mutex::new(Equalizer::new(48000)));
        {
            let mut eq = equalizer.lock();
            eq.set_enabled(true);
            eq.set_preamp_db(12.0);
        }

        let mut source = DecoderSource::new(
            shared,
            Arc::new(FftAnalyzer::new(48000)),
            equalizer,
            Arc::new(Mutex::new(StretchProcessor::new(2, 48000))),
            48000,
            2,
        );

        assert!(source.next().unwrap().abs() <= 0.980001);
        assert!(source.next().unwrap().abs() <= 0.980001);
    }

    #[test]
    fn keeps_quiet_samples_before_limited_peak() {
        let shared = Shared::new(48000, 2);
        shared.push(AudioChunk {
            player_samples: vec![0.1, -0.1, 2.0, -2.0],
            fft_samples: Vec::new(),
        });

        let mut source = DecoderSource::new(
            shared,
            Arc::new(FftAnalyzer::new(48000)),
            Arc::new(Mutex::new(Equalizer::new(48000))),
            Arc::new(Mutex::new(StretchProcessor::new(2, 48000))),
            48000,
            2,
        );

        assert!((source.next().unwrap() - 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() + 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() - 0.98).abs() < 1e-6);
        assert!((source.next().unwrap() + 0.98).abs() < 1e-6);
    }

    #[test]
    fn returns_short_silence_when_decoder_temporarily_underruns() {
        let shared = Shared::new(1000, 2);
        let mut source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::new(FftAnalyzer::new(1000)),
            Arc::new(Mutex::new(Equalizer::new(1000))),
            Arc::new(Mutex::new(StretchProcessor::new(2, 1000))),
            1000,
            2,
        );

        assert_eq!(source.next(), Some(0.0));
        shared.push(AudioChunk {
            player_samples: vec![0.25, -0.25],
            fft_samples: Vec::new(),
        });
        for _ in 0..39 {
            assert_eq!(source.next(), Some(0.0));
        }
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(source.next(), Some(-0.25));
    }
}
