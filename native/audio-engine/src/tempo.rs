//! 变速 / 变调（Signalsmith Stretch 算法）
//!
//! 接入位置：`source.rs` 的 `DecoderSource::next()`，紧挨现有均衡器。
//! 输入/输出都是交错 f32 立体声样本。
//!
//! 参数：
//! - `speed`：[0.5, 2.0]，1.0 = 原速；通过 `process` 输入/输出长度比实现
//! - `pitch_semitones`：[-12, 12]，0 = 不变调；仅在 `pitch_sync=true` 下生效
//! - `pitch_sync`：true = 变速保音调（默认）；false = 变速变调（老式磁带），
//!   此时 `effective_transpose = 12·log2(speed)`，UI 上 pitch 滑块 disable

use signalsmith_stretch::Stretch;

/// "约等于零"的浮点比较阈值。
///
/// `f32::EPSILON ≈ 1.19e-7` 对 IPC 来回（JS f64 → Rust f32）转换中的 ULP 抖动太敏感，
/// 容易把"应当 bypass"的 1.0 误判成"非 bypass"。UI 步进 0.05，1e-4 既能容忍抖动，
/// 又不会和任何真实档位冲突。
const FLOAT_EQ_EPS: f32 = 1e-4;

pub(crate) struct StretchProcessor {
    stretch: Stretch,
    channels: u16,
    speed: f32,
    pitch_semitones: i8,
    pitch_sync: bool,
    /// 当前已下发到 stretch 的有效 transpose（用于减少冗余的 set 调用）
    applied_transpose: f32,
}

impl StretchProcessor {
    /// 构造一个默认 1.0× / 0 半音 / sync=ON 的处理器，初始即 bypass
    pub(crate) fn new(channels: u16, sample_rate: u32) -> Self {
        let stretch = Stretch::preset_cheaper(channels as u32, sample_rate);
        Self {
            stretch,
            channels,
            speed: 1.0,
            pitch_semitones: 0,
            pitch_sync: true,
            applied_transpose: 0.0,
        }
    }

    /// 1.0 速度 + 当前模式下 transpose 为 0：bypass，可走 passthrough
    pub(crate) fn is_bypass(&self) -> bool {
        (self.speed - 1.0).abs() < FLOAT_EQ_EPS
            && self.effective_transpose().abs() < FLOAT_EQ_EPS
    }

    /// sync=ON：transpose = pitch_semitones（独立调音调）
    /// sync=OFF：transpose = 12·log2(speed)（音调跟着速度走）
    fn effective_transpose(&self) -> f32 {
        if self.pitch_sync {
            self.pitch_semitones as f32
        } else {
            12.0 * self.speed.log2()
        }
    }

    fn sync_transpose_to_stretch(&mut self) {
        let target = self.effective_transpose();
        if (target - self.applied_transpose).abs() > FLOAT_EQ_EPS {
            self.stretch.set_transpose_factor_semitones(target, None);
            self.applied_transpose = target;
        }
    }

    /// 设置播放速度，自动 clamp 到 [0.5, 2.0]。
    /// 非有限值（NaN/±Inf）降级为 1.0，避免 NaN 经 log2/process 传播导致整段静音
    pub(crate) fn set_speed(&mut self, speed: f32) {
        let v = if speed.is_finite() { speed } else { 1.0 };
        self.speed = v.clamp(0.5, 2.0);
        // sync=OFF 时 transpose 跟着 speed 变
        if !self.pitch_sync {
            self.sync_transpose_to_stretch();
        }
    }

    /// 设置音调偏移（半音），自动 clamp 到 [-12, 12]。
    /// sync=OFF 时只更新内部值不下发，等切回 sync=ON 时生效。
    pub(crate) fn set_pitch(&mut self, semitones: i8) {
        self.pitch_semitones = semitones.clamp(-12, 12);
        // sync=ON 时 pitch 独立调，立即下发
        if self.pitch_sync {
            self.sync_transpose_to_stretch();
        }
    }

    /// 切换"音调同步"开关，立即按新公式重算 transpose 并下发
    pub(crate) fn set_pitch_sync(&mut self, sync: bool) {
        self.pitch_sync = sync;
        // 切模式后 effective_transpose 公式变了，强制刷新
        self.sync_transpose_to_stretch();
    }

    pub(crate) fn speed(&self) -> f32 {
        self.speed
    }

    pub(crate) fn pitch(&self) -> i8 {
        self.pitch_semitones
    }

    pub(crate) fn pitch_sync(&self) -> bool {
        self.pitch_sync
    }

    /// 切歌 / seek 时调用，清空 FFT 历史，避免拼接处出现瞬态
    pub(crate) fn reset(&mut self) {
        self.stretch.reset();
    }

    /// 处理一块交错 f32 样本，写入 `output`。
    /// bypass 时直接 extend，零开销。
    pub(crate) fn process(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if self.is_bypass() {
            output.extend_from_slice(input);
            return;
        }

        let channels = self.channels as usize;
        let input_frames = input.len() / channels;
        if input_frames == 0 {
            return;
        }

        // 输出帧数 = 输入帧数 / speed（speed > 1 → 输出更短即更快）
        let output_frames = ((input_frames as f32) / self.speed).round() as usize;
        if output_frames == 0 {
            return;
        }

        let start = output.len();
        output.resize(start + output_frames * channels, 0.0);
        self.stretch.process(input, &mut output[start..]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_bypass() {
        let p = StretchProcessor::new(2, 48000);
        assert!(p.is_bypass());
    }

    #[test]
    fn sync_on_pitch_only_changes_transpose() {
        let mut p = StretchProcessor::new(2, 48000);
        p.set_pitch(5);
        assert!(!p.is_bypass());
        assert!((p.effective_transpose() - 5.0).abs() < 1e-6);
    }

    #[test]
    fn sync_off_speed_drives_transpose() {
        let mut p = StretchProcessor::new(2, 48000);
        p.set_pitch_sync(false);
        p.set_speed(2.0);
        // speed=2 → transpose ≈ 12 半音（升 1 个八度）
        assert!((p.effective_transpose() - 12.0).abs() < 1e-3);
    }

    #[test]
    fn bypass_passthrough_preserves_samples() {
        let mut p = StretchProcessor::new(2, 48000);
        let input = vec![0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
        let mut output = Vec::new();
        p.process(&input, &mut output);
        assert_eq!(output, input);
    }
}
