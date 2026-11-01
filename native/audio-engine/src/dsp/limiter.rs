const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;

pub(crate) struct OutputLimiter {
    gain: f32,
}

impl OutputLimiter {
    /// 创建没有衰减历史的输出保护器
    pub(crate) fn new() -> Self {
        Self { gain: 1.0 }
    }

    /// 对整帧及其声部施加相同增益，保留相减重组时的幅度关系
    /// @param samples - 当前块的完整混音
    /// @param channels - 交错声道数
    /// @param stems - 可选的同时间轴鼓、贝斯、人声
    pub(crate) fn process(
        &mut self,
        samples: &mut [f32],
        channels: u16,
        mut stems: Option<&mut [Vec<f32>; 3]>,
    ) {
        let channels = usize::from(channels);
        debug_assert!(channels > 0 && samples.len().is_multiple_of(channels));
        for (index, frame) in samples.chunks_exact_mut(channels).enumerate() {
            let peak = frame
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
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
            let gain = self.gain.min(target_gain);
            for sample in frame {
                *sample *= gain;
            }
            if let Some(stems) = &mut stems {
                for stem in stems.iter_mut() {
                    for sample in &mut stem[index * channels..(index + 1) * channels] {
                        *sample *= gain;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/limiter.rs"]
mod tests;
