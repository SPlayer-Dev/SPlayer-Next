use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::shared::{PopResult, Shared};
use crate::tempo::StretchProcessor;

const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;
const MEDIA_FRAME_SCALE: f64 = (1_u64 << 32) as f64;

/// 一帧经过 DSP 的立体声数据，以及播放该帧后应推进的媒体帧数。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StereoFrame {
    pub left: f32,
    pub right: f32,
    pub media_frame_q32: u64,
}

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

/// 从共享缓冲区拉取样本的 DSP 输出源。
///
/// 该类型只运行在 `audio-dsp-output` 线程，CPAL callback 不会触碰它。
pub struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// 跨曲目共享的均衡器，load/seek 时通过 Arc::clone 传入
    equalizer: Arc<Mutex<Equalizer>>,
    /// 跨曲目共享的变速变调处理器，load/seek 时通过 Arc::clone 传入
    tempo: Arc<Mutex<StretchProcessor>>,
    /// 本地缓冲，减少锁竞争
    local_buffer: VecDeque<StereoFrame>,
    /// stretch 输出复用缓冲（避免每帧分配）
    tempo_scratch: Vec<f32>,
    limiter: OutputLimiter,
}

impl DecoderSource {
    pub fn new(
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        equalizer: Arc<Mutex<Equalizer>>,
        tempo: Arc<Mutex<StretchProcessor>>,
    ) -> Self {
        Self {
            shared,
            fft,
            equalizer,
            tempo,
            local_buffer: VecDeque::new(),
            tempo_scratch: Vec::new(),
            limiter: OutputLimiter::new(),
        }
    }

    /// 生成一帧待投递到 CPAL ring 的立体声数据。
    pub fn next_frame(&mut self) -> Option<StereoFrame> {
        // 快速路径：从本地缓冲返回（无原子操作）
        if let Some(sample) = self.local_buffer.pop_front() {
            return Some(sample);
        }
        // 慢速路径：从共享缓冲区非阻塞获取，跳过空数据块
        loop {
            match self.shared.try_pop() {
                // 将 FFT 样本推送给分析器
                PopResult::Chunk(chunk) => {
                    if self.fft.is_enabled() {
                        self.fft.push_interleaved_samples(&chunk.player_samples);
                    }

                    // 填充本地缓冲，一次性批量计数（而非逐采样）
                    if !chunk.player_samples.is_empty() {
                        let mut samples = chunk.player_samples;
                        // 对整 chunk 应用 EQ：每秒只锁 50~100 次，开销摊到几千个样本上
                        self.equalizer
                            .lock()
                            .process_interleaved_stereo(&mut samples);
                        // 变速变调（bypass 时直接 extend，零开销）
                        self.tempo_scratch.clear();
                        let input_frames = samples.len() / 2;
                        self.tempo.lock().process(&samples, &mut self.tempo_scratch);
                        self.shared.recycle_buffer(samples);
                        if !self.tempo_scratch.is_empty() {
                            self.limiter.process(&mut self.tempo_scratch);
                            let output_frames = self.tempo_scratch.len() / 2;
                            let media_frame_q32 = if output_frames > 0 {
                                ((input_frames as f64 / output_frames as f64) * MEDIA_FRAME_SCALE)
                                    .round() as u64
                            } else {
                                0
                            };
                            self.local_buffer
                                .extend(self.tempo_scratch.chunks_exact(2).map(|frame| {
                                    StereoFrame {
                                        left: frame[0],
                                        right: frame[1],
                                        media_frame_q32,
                                    }
                                }));
                        }
                        // stretch 在预热期可能本帧没产出，没样本就继续拉下一块
                        let Some(s) = self.local_buffer.pop_front() else {
                            continue;
                        };
                        return Some(s);
                    }
                    // 空数据块（重采样器预热期），继续获取下一个
                }
                PopResult::Pending => {
                    // 只为本次请求返回静音；下次请求必须立刻重新检查真实 PCM。
                    return Some(StereoFrame {
                        left: 0.0,
                        right: 0.0,
                        media_frame_q32: 0,
                    });
                }
                PopResult::Finished => {
                    // 数据源耗尽，标记消费完毕
                    return None;
                }
            }
        }
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
        });

        let equalizer = Arc::new(Mutex::new(Equalizer::new(48000)));
        {
            let mut eq = equalizer.lock();
            eq.set_enabled(true);
            eq.set_preamp_db(12.0);
        }

        let mut source = DecoderSource::new(
            shared,
            Arc::new(FftAnalyzer::new()),
            equalizer,
            Arc::new(Mutex::new(StretchProcessor::new(2, 48000))),
        );

        let frame = source.next_frame().unwrap();
        assert!(frame.left.abs() <= 0.980001);
        assert!(frame.right.abs() <= 0.980001);
    }

    #[test]
    fn keeps_quiet_samples_before_limited_peak() {
        let shared = Shared::new(48000, 2);
        shared.push(AudioChunk {
            player_samples: vec![0.1, -0.1, 2.0, -2.0],
        });

        let mut source = DecoderSource::new(
            shared,
            Arc::new(FftAnalyzer::new()),
            Arc::new(Mutex::new(Equalizer::new(48000))),
            Arc::new(Mutex::new(StretchProcessor::new(2, 48000))),
        );

        let quiet = source.next_frame().unwrap();
        assert!((quiet.left - 0.1).abs() < 1e-6);
        assert!((quiet.right + 0.1).abs() < 1e-6);
        let peak = source.next_frame().unwrap();
        assert!((peak.left - 0.98).abs() < 1e-6);
        assert!((peak.right + 0.98).abs() < 1e-6);
    }

    #[test]
    fn returns_short_silence_when_decoder_temporarily_underruns() {
        let shared = Shared::new(1000, 2);
        let mut source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::new(FftAnalyzer::new()),
            Arc::new(Mutex::new(Equalizer::new(1000))),
            Arc::new(Mutex::new(StretchProcessor::new(2, 1000))),
        );

        assert_eq!(source.next_frame().unwrap().media_frame_q32, 0);
        shared.push(AudioChunk {
            player_samples: vec![0.25, -0.25],
        });
        let frame = source.next_frame().unwrap();
        assert_eq!(frame.left, 0.25);
        assert_eq!(frame.right, -0.25);
        assert_eq!(frame.media_frame_q32, 1_u64 << 32);
    }

    #[test]
    fn media_clock_tracks_input_frames_after_speed_change() {
        let shared = Shared::new(48_000, 2);
        shared.push(AudioChunk {
            player_samples: vec![0.1; 400],
        });
        let tempo = Arc::new(Mutex::new(StretchProcessor::new(2, 48_000)));
        tempo.lock().set_speed(2.0);
        let mut source = DecoderSource::new(
            shared,
            Arc::new(FftAnalyzer::new()),
            Arc::new(Mutex::new(Equalizer::new(48_000))),
            tempo,
        );

        let mut media_frame_q32 = 0_u64;
        for _ in 0..100 {
            media_frame_q32 += source.next_frame().unwrap().media_frame_q32;
        }
        assert_eq!(media_frame_q32, 200_u64 << 32);
    }
}
