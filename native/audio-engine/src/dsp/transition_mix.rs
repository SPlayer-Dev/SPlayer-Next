use std::f32::consts::{FRAC_1_SQRT_2, FRAC_PI_2, TAU};

use crate::decoder::transition_source::MixEnvelope;

/// 按总进度计算两路鼓、贝斯、人声、伴奏增益，贝斯线性交接以免低频叠加
/// @param envelopes - 当前曲与下一曲各四路的交接区间
/// @param progress - 总交接进度
/// @returns 两路鼓、贝斯、人声、伴奏与底鼓增益
pub(crate) fn stem_gains(envelopes: &[MixEnvelope; 8], progress: f32) -> [[f32; 5]; 2] {
    let mut gains = [[0.0; 5]; 2];
    for index in 0..4 {
        let out_phase = envelopes[index].phase(progress);
        let in_phase = envelopes[index + 4].phase(progress);
        let (outgoing, incoming) = match index {
            1 => (1.0 - out_phase, in_phase),
            // 下一曲的鼓按平方曲线叠入，交换前保持低电平，避免两套鼓同时突出
            0 => (
                (out_phase * FRAC_PI_2).cos(),
                (in_phase * FRAC_PI_2).sin().powi(2),
            ),
            _ => ((out_phase * FRAC_PI_2).cos(), (in_phase * FRAC_PI_2).sin()),
        };
        let norm = outgoing.hypot(incoming).max(1.0);
        gains[0][index] = outgoing / norm;
        gains[1][index] = incoming / norm;
    }
    // 下一曲的底鼓与当前曲的鼓在同一重拍换手，之前只有踩镲等高频提前叠入，避免两套底鼓并存
    gains[0][4] = gains[0][0];
    gains[1][4] = (envelopes[0].phase(progress) * FRAC_PI_2).sin();
    gains
}

/// 下一曲鼓轨的底鼓分频，按声道保存二阶高通历史
pub(crate) struct KickSplit {
    coefficients: [f32; 5],
    history: Vec<[f32; 4]>,
}

impl KickSplit {
    /// 在控制线程按输出格式分配滤波状态
    /// @param sample_rate - 输出采样率
    /// @param channels - 输出声道数
    pub(crate) fn new(sample_rate: u32, channels: usize) -> Self {
        let omega = TAU * 150.0 / sample_rate as f32;
        let alpha = omega.sin() / (2.0 * FRAC_1_SQRT_2);
        let b0 = (1.0 + omega.cos()) / 2.0 / (1.0 + alpha);
        Self {
            coefficients: [
                b0,
                -2.0 * b0,
                b0,
                -2.0 * omega.cos() / (1.0 + alpha),
                (1.0 - alpha) / (1.0 + alpha),
            ],
            history: vec![[0.0; 4]; channels],
        }
    }

    /// 取出鼓轨 150 Hz 以下的底鼓部分，与剩余高频相加仍是原信号
    /// @param sample - 鼓轨采样
    /// @param channel - 声道
    /// @returns 低频部分
    pub(crate) fn low(&mut self, sample: f32, channel: usize) -> f32 {
        let [b0, b1, b2, a1, a2] = self.coefficients;
        let [x1, x2, y1, y2] = self.history[channel];
        let high = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        self.history[channel] = [sample, x1, high, y1];
        sample - high
    }
}

/// 电平匹配从交接起点线性回到原始增益
/// @param ratio - 下一曲与当前曲的电平比
/// @param progress - 总交接进度
/// @returns 两路电平增益
pub(crate) fn level_curve(ratio: f32, progress: f32) -> [f32; 2] {
    let incoming = (1.0 / ratio).min(1.0);
    [
        1.0 + (ratio.min(1.0) - 1.0) * progress,
        incoming + (1.0 - incoming) * progress,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// 底鼓分频保留 60 Hz 而滤掉踩镲频段
    fn kick_split_keeps_the_kick_band_only() {
        let energy = |frequency: f32| {
            let mut split = KickSplit::new(44_100, 1);
            (0..44_100)
                .map(|index| {
                    let sample = (TAU * frequency * index as f32 / 44_100.0).sin();
                    split.low(sample, 0).powi(2)
                })
                .skip(4410)
                .sum::<f32>()
                / 39_690.0
        };
        assert!(energy(60.0) > 0.4, "{}", energy(60.0));
        assert!(energy(5000.0) < 0.001, "{}", energy(5000.0));
    }
}
