//! 10 频段参数化均衡器（peaking biquad）+ 前级增益。
//!
//! 滤波器系数采用 RBJ Audio EQ Cookbook 的 peaking 公式，
//! 实现形式为 Direct Form II Transposed（数值稳定）。
//! 每条频段、每个声道独立保留状态，立体声共享系数（左右声道处理一致）。

use std::f32::consts::PI;

/// 频段中心频率（Hz）
pub const EQ_FREQUENCIES: [f32; EQ_BAND_COUNT] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

/// 滤波器 Q 值（带宽参数），与 lx-music 的 Web Audio BiquadFilterNode 默认 Q 一致
pub const EQ_Q: f32 = 1.4;

/// 频段数量
pub const EQ_BAND_COUNT: usize = 10;

/// 声道数（仅支持立体声）
pub const EQ_CHANNEL_COUNT: usize = 2;

/// 每段增益限制（dB）
const BAND_GAIN_LIMIT_DB: f32 = 15.0;

/// 前级增益限制（dB）
const PREAMP_LIMIT_DB: f32 = 12.0;

/// dB → 线性增益
fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// 单个 peaking biquad 滤波器（Direct Form II Transposed）
#[derive(Clone, Copy, Debug)]
struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadFilter {
    fn passthrough() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// 设置为 peaking 滤波器，gain_db = 0 时退化为直通
    fn set_peaking(&mut self, freq: f32, sample_rate: f32, q: f32, gain_db: f32) {
        if gain_db.abs() < 1e-3 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }
        // RBJ Audio EQ Cookbook：peaking EQ
        let amp = 10.0_f32.powf(gain_db / 40.0);
        let omega = 2.0 * PI * freq / sample_rate;
        let sin_omega = omega.sin();
        let cos_omega = omega.cos();
        let alpha = sin_omega / (2.0 * q);

        let b0 = 1.0 + alpha * amp;
        let b1 = -2.0 * cos_omega;
        let b2 = 1.0 - alpha * amp;
        let a0 = 1.0 + alpha / amp;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha / amp;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    #[inline]
    fn process_sample(&mut self, x: f32) -> f32 {
        // Direct Form II Transposed
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    fn reset_state(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// 10 频段均衡器，立体声独立保留滤波器状态
pub struct Equalizer {
    /// [声道][频段]
    filters: [[BiquadFilter; EQ_BAND_COUNT]; EQ_CHANNEL_COUNT],
    sample_rate: f32,
    band_gains_db: [f32; EQ_BAND_COUNT],
    preamp_linear: f32,
    enabled: bool,
}

impl Equalizer {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            filters: [[BiquadFilter::passthrough(); EQ_BAND_COUNT]; EQ_CHANNEL_COUNT],
            sample_rate: sample_rate as f32,
            band_gains_db: [0.0; EQ_BAND_COUNT],
            preamp_linear: 1.0,
            enabled: false,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// 更新所有频段增益（dB），长度不等于 EQ_BAND_COUNT 时按短端截取。
    /// 非有限值（NaN/±Inf）按 0dB 处理，避免污染 biquad 系数 → 样本变 NaN → 硬件毛刺
    pub fn set_band_gains(&mut self, gains_db: &[f32]) {
        for (i, gain) in gains_db.iter().take(EQ_BAND_COUNT).enumerate() {
            let v = if gain.is_finite() { *gain } else { 0.0 };
            self.band_gains_db[i] = v.clamp(-BAND_GAIN_LIMIT_DB, BAND_GAIN_LIMIT_DB);
        }
        self.recompute_coefficients();
    }

    pub fn band_gains_db(&self) -> [f32; EQ_BAND_COUNT] {
        self.band_gains_db
    }

    /// 非有限值按 0dB 处理（同 set_band_gains），避免 NaN 污染 preamp_linear
    pub fn set_preamp_db(&mut self, db: f32) {
        let v = if db.is_finite() { db } else { 0.0 };
        let clamped = v.clamp(-PREAMP_LIMIT_DB, PREAMP_LIMIT_DB);
        self.preamp_linear = db_to_linear(clamped);
    }

    pub fn preamp_db(&self) -> f32 {
        20.0 * self.preamp_linear.log10()
    }

    /// 清空滤波器状态（切歌、seek 时调用，避免上一首尾音残留导致瞬态不稳定）
    pub fn reset_state(&mut self) {
        for channel in self.filters.iter_mut() {
            for filter in channel.iter_mut() {
                filter.reset_state();
            }
        }
    }

    /// 更新当前所有频段的滤波器系数（变更增益或采样率后调用）
    fn recompute_coefficients(&mut self) {
        for channel in self.filters.iter_mut() {
            for (i, filter) in channel.iter_mut().enumerate() {
                filter.set_peaking(EQ_FREQUENCIES[i], self.sample_rate, EQ_Q, self.band_gains_db[i]);
            }
        }
    }

    /// 处理交错排列的立体声 PCM（L R L R ...）。EQ 关闭时直接返回。
    pub fn process_interleaved_stereo(&mut self, samples: &mut [f32]) {
        if !self.enabled {
            return;
        }
        let preamp = self.preamp_linear;
        for frame in samples.chunks_exact_mut(EQ_CHANNEL_COUNT) {
            let mut left = frame[0] * preamp;
            let mut right = frame[1] * preamp;
            for band in 0..EQ_BAND_COUNT {
                left = self.filters[0][band].process_sample(left);
                right = self.filters[1][band].process_sample(right);
            }
            frame[0] = left;
            frame[1] = right;
        }
    }
}
