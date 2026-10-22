const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;

pub(crate) struct OutputLimiter {
    gain: f32,
}

impl OutputLimiter {
    pub(crate) fn new() -> Self {
        Self { gain: 1.0 }
    }

    pub(crate) fn process(&mut self, samples: &mut [f32], channels: u16) {
        let channels = usize::from(channels);
        debug_assert!(channels > 0 && samples.len().is_multiple_of(channels));
        for frame in samples.chunks_exact_mut(channels) {
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
            for sample in frame {
                *sample *= self.gain;
                *sample = sample.clamp(-OUTPUT_CEILING, OUTPUT_CEILING);
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/limiter.rs"]
mod tests;
