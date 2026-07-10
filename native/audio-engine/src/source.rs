use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::Source;

use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::shared::Shared;
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
    high_pass_left: BiquadHighPass,
    high_pass_right: BiquadHighPass,
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
            tempo_scratch: Vec::new(),
            high_pass_left: BiquadHighPass::new(),
            high_pass_right: BiquadHighPass::new(),
            limiter: OutputLimiter::new(),
            sample_rate,
            channels,
        }
    }

    fn apply_high_pass_automation(&mut self, samples: &mut [f32]) {
        let Some(plan) = self.shared.high_pass_automation() else {
            return;
        };
        if self.channels != 2 {
            return;
        }
        let base_samples = self.shared.samples_consumed_count();
        for (frame_index, frame) in samples.chunks_exact_mut(2).enumerate() {
            let consumed = base_samples + frame_index as u64 * 2;
            let cutoff = plan.cutoff_at(consumed);
            frame[0] = self
                .high_pass_left
                .process(frame[0], cutoff, self.sample_rate);
            frame[1] = self
                .high_pass_right
                .process(frame[1], cutoff, self.sample_rate);
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
                    self.apply_high_pass_automation(&mut samples);
                    // 对整 chunk 应用 EQ：每秒只锁 50~100 次，开销摊到几千个样本上
                    self.equalizer
                        .lock()
                        .process_interleaved_stereo(&mut samples);
                    // 源时间长度（按输入计数，与 speed 无关；让 consumed_position 反映源进度）
                    let source_count = samples.len() as u64;
                    // 变速变调（bypass 时直接 extend，零开销）
                    self.tempo_scratch.clear();
                    self.tempo.lock().process(&samples, &mut self.tempo_scratch);
                    if !self.tempo_scratch.is_empty() {
                        self.limiter.process(&mut self.tempo_scratch);
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
}
