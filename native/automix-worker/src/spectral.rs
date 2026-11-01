use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

pub const SIZE: usize = 4096;
pub const HOP: usize = 1024;
pub const CELLS: usize = super::demucs::FRAMES / HOP;
const BEGIN: usize = SIZE / 2 + HOP / 2 * 3;

pub struct Spectral {
    forward: Arc<dyn Fft<f32>>,
    inverse: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    normalizer: Vec<f32>,
}

impl Spectral {
    /// 复用有限频谱窗口和官方重叠归一化系数
    /// @returns 可重复使用的正逆变换计划
    pub fn new() -> Self {
        let mut planner = FftPlanner::new();
        let window: Vec<f32> = (0..SIZE)
            .map(|index| {
                (0.5 - 0.5 * (std::f64::consts::TAU * index as f64 / SIZE as f64).cos()) as f32
            })
            .collect();
        let mut normalizer = vec![0.0; super::demucs::FRAMES];
        for cell in 0..CELLS + 4 {
            for (index, value) in window.iter().enumerate() {
                let at = cell * HOP + index;
                if at >= BEGIN && at < BEGIN + normalizer.len() {
                    normalizer[at - BEGIN] += value * value;
                }
            }
        }
        Self {
            forward: planner.plan_fft_forward(SIZE),
            inverse: planner.plan_fft_inverse(SIZE),
            window,
            normalizer,
        }
    }

    /// 按官方布局与反射边界生成四通道实数频谱
    /// @param waveform - 两路连续排列的固定长度波形
    /// @returns 通道、频率、时间顺序的频谱
    pub fn forward(&self, waveform: &[f32]) -> Vec<f32> {
        let frames = super::demucs::FRAMES;
        let mut spectrum = vec![0.0; 4 * (SIZE / 2) * CELLS];
        let mut buffer = vec![Complex::default(); SIZE];
        for channel in 0..2 {
            for cell in 0..CELLS {
                for (index, value) in buffer.iter_mut().enumerate() {
                    let at = (cell * HOP + index) as isize - (HOP / 2 * 3) as isize;
                    let at = if at < 0 {
                        -at
                    } else if at >= frames as isize {
                        frames as isize * 2 - 2 - at
                    } else {
                        at
                    } as usize;
                    *value =
                        Complex::new(waveform[channel * frames + at] * self.window[index], 0.0);
                }
                self.forward.process(&mut buffer);
                for (bin, value) in buffer.iter().take(SIZE / 2).enumerate() {
                    spectrum[((channel * 2) * (SIZE / 2) + bin) * CELLS + cell] = value.re / 64.0;
                    spectrum[((channel * 2 + 1) * (SIZE / 2) + bin) * CELLS + cell] =
                        value.im / 64.0;
                }
            }
        }
        spectrum
    }

    /// 逐帧逆变换并直接叠加，避免持有整批复数窗口
    /// @param frequency - 模型预测的四声部频谱
    /// @param temporal - 模型预测的四声部波形
    /// @returns 鼓、贝斯、人声各自双声道的连续波形
    pub fn reconstruct(&self, frequency: &[f32], temporal: &[f32]) -> Vec<f32> {
        let frames = super::demucs::FRAMES;
        let mut result = vec![0.0; 6 * frames];
        let mut buffer = vec![Complex::default(); SIZE];
        for (lane, source) in [0, 1, 3].into_iter().enumerate() {
            for channel in 0..2 {
                let output =
                    &mut result[(lane * 2 + channel) * frames..(lane * 2 + channel + 1) * frames];
                for cell in 0..CELLS {
                    buffer.fill(Complex::default());
                    for bin in 0..SIZE / 2 {
                        let re = frequency
                            [((source * 4 + channel * 2) * (SIZE / 2) + bin) * CELLS + cell];
                        let im = frequency
                            [((source * 4 + channel * 2 + 1) * (SIZE / 2) + bin) * CELLS + cell];
                        buffer[bin] = Complex::new(re, im);
                        if bin != 0 {
                            buffer[SIZE - bin] = buffer[bin].conj();
                        }
                    }
                    self.inverse.process(&mut buffer);
                    for (index, value) in buffer.iter().enumerate() {
                        let at = (cell + 2) * HOP + index;
                        if at >= BEGIN && at < BEGIN + frames {
                            output[at - BEGIN] += value.re / 64.0 * self.window[index];
                        }
                    }
                }
                for (index, value) in output.iter_mut().enumerate() {
                    *value = *value / self.normalizer[index]
                        + temporal[(source * 2 + channel) * frames + index];
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demucs::FRAMES;

    #[test]
    /// 校验频谱通道顺序、正交缩放和内部帧的相位
    fn stereo_tone_has_expected_spectrum() {
        let waveform: Vec<f32> = (0..2 * FRAMES)
            .map(|index| {
                let frame = (index % FRAMES) as f64;
                if index < FRAMES {
                    (std::f64::consts::TAU * 32.0 * frame / SIZE as f64).sin() as f32
                } else {
                    0.25
                }
            })
            .collect();
        let spectrum = Spectral::new().forward(&waveform);
        for cell in [4, 60, CELLS - 4] {
            assert!(spectrum[32 * CELLS + cell].abs() < 1e-5);
            assert!((spectrum[(SIZE / 2 + 32) * CELLS + cell] + 16.0).abs() < 1e-5);
            assert!((spectrum[SIZE * CELLS + cell] - 8.0).abs() < 1e-5);
        }
    }

    #[test]
    /// 校验首尾反射、重叠归一化和三个目标声部的映射
    fn reconstructed_stems_preserve_interior_waveform() {
        let spectral = Spectral::new();
        let waveform: Vec<f32> = (0..2 * FRAMES)
            .map(|index| (index as f32 * 0.031).sin() * 0.2)
            .collect();
        let input = spectral.forward(&waveform);
        let mut frequency = vec![0.0; input.len() * 4];
        for source in [0, 1, 3] {
            frequency[source * input.len()..(source + 1) * input.len()].copy_from_slice(&input);
        }
        let output = spectral.reconstruct(&frequency, &vec![0.0; 8 * FRAMES]);
        for lane in 0..6 {
            for frame in (SIZE..FRAMES - SIZE).step_by(131) {
                assert!(
                    (output[lane * FRAMES + frame] - waveform[(lane % 2) * FRAMES + frame]).abs()
                        < 1e-6
                );
            }
        }
        assert!(output.iter().all(|value| value.is_finite()));
    }

    #[test]
    /// 频率分支为零时保留目标波形分支，不引入未使用的伴奏声部
    fn temporal_sources_are_selected_without_crossing_channels() {
        let temporal: Vec<f32> = (0..8 * FRAMES)
            .map(|index| (index / FRAMES) as f32)
            .collect();
        let output = Spectral::new().reconstruct(&vec![0.0; 16 * (SIZE / 2) * CELLS], &temporal);
        for (lane, expected) in [0.0, 1.0, 2.0, 3.0, 6.0, 7.0].into_iter().enumerate() {
            assert!(output[lane * FRAMES..(lane + 1) * FRAMES]
                .iter()
                .all(|value| *value == expected));
        }
    }
}
