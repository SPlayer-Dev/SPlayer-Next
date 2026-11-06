//! 变速 / 变调（Signalsmith Stretch 算法）
//!
//! 接入位置：`decoder::processing` 的后台 DSP 线程，在均衡器之后处理。
//! 输入/输出都是交错 f32 多声道样本。
//!
//! 参数：
//! - `speed`：[0.5, 2.0]，1.0 = 原速；通过 `process` 输入/输出长度比实现
//! - `pitch_semitones`：[-12, 12]，0 = 不变调；仅在 `pitch_sync=true` 下生效
//! - `pitch_sync`：true = 变速保音调（默认）；false = 变速变调（老式磁带），
//!   此时 `effective_transpose = 12·log2(speed)`，UI 上 pitch 滑块 disable

use super::automix_tempo::AutoMixStretch;
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
    /// 当前 stretch 内核构建所用的采样率
    sample_rate: u32,
    speed: f32,
    pitch_semitones: i8,
    pitch_sync: bool,
    /// 当前已下发到 stretch 的有效 transpose（用于减少冗余的 set 调用）
    applied_transpose: f32,
    automix: Option<AutoMixStretch>,
    frame_fraction: f64,
}

impl StretchProcessor {
    /// 构造一个默认 1.0× / 0 半音 / sync=ON 的处理器，初始即 bypass
    /// @param channels - 输出声道数
    /// @param sample_rate - 输出采样率
    /// @returns 默认直通的处理器
    pub(crate) fn new(channels: u16, sample_rate: u32) -> Self {
        let stretch = Stretch::preset_default(channels as u32, sample_rate);
        Self {
            stretch,
            channels,
            sample_rate,
            speed: 1.0,
            pitch_semitones: 0,
            pitch_sync: true,
            applied_transpose: 0.0,
            automix: None,
            frame_fraction: 0.0,
        }
    }

    /// 更新输出格式；采样率或声道数改变后必须重建 stretch 内核
    /// @param sample_rate - 新输出采样率
    /// @param channels - 新输出声道数
    pub(crate) fn set_output_format(&mut self, sample_rate: u32, channels: u16) {
        if sample_rate == self.sample_rate && channels == self.channels {
            return;
        }
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.automix = None;
        self.frame_fraction = 0.0;
        self.stretch = Stretch::preset_default(u32::from(channels), sample_rate);
        // 新内核 transpose 归零，强制按当前参数重新下发
        self.applied_transpose = 0.0;
        self.sync_transpose_to_stretch();
    }

    /// 1.0 速度 + 当前模式下 transpose 为 0：bypass，可走 passthrough
    /// @returns 未启用任何变速或变调处理时为 true
    pub(crate) fn is_bypass(&self) -> bool {
        self.automix.is_none()
            && (self.speed - 1.0).abs() < FLOAT_EQ_EPS
            && self.effective_transpose().abs() < FLOAT_EQ_EPS
    }

    /// 获取当前自动倍率，供同一音源的声部保持相同处理时序
    /// @returns 正常播放时为 1，否则为实际自动倍率
    pub(crate) fn automix_rate(&self) -> f32 {
        self.automix
            .as_ref()
            .filter(|processor| !processor.finishing)
            .map_or(1.0, |processor| processor.rate as f32)
    }

    /// 设置独立的 AutoMix 倍率，恢复时先排空自动变速流
    /// @param rate - 自动对拍倍率，1 表示退出自动变速
    pub(crate) fn set_automix_rate(&mut self, rate: f32) {
        if (rate - 1.0).abs() < FLOAT_EQ_EPS {
            if let Some(automix) = &mut self.automix {
                automix.finishing = true;
            }
        } else {
            self.automix = Some(AutoMixStretch::new(self.channels, self.sample_rate, rate));
        }
    }

    /// 在正常 EOF 时排出自动变速器持有的尾音
    /// @param output - 尾音写入的复用缓冲
    /// @returns 尾音覆盖的源交错采样数
    pub(crate) fn flush_automix(&mut self, output: &mut Vec<f32>) -> u64 {
        self.automix
            .take()
            .map(|mut automix| automix.flush(output))
            .unwrap_or(0)
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
        self.automix = None;
        self.frame_fraction = 0.0;
    }

    /// 处理交错采样并返回有效输出对应的源采样数，预热不推进播放位置
    /// @param input - 本次输入的交错采样
    /// @param output - 接收有效音频的复用缓冲
    /// @returns 输出覆盖的源交错采样数
    pub(crate) fn process(&mut self, input: &[f32], output: &mut Vec<f32>) -> u64 {
        if input.is_empty() {
            return 0;
        }
        let mut prefix = 0;
        if let Some(automix) = &mut self.automix {
            if !automix.finishing {
                return automix.process(input, output);
            }
            prefix = self.flush_automix(output);
        }
        if self.is_bypass() {
            output.extend_from_slice(input);
            return prefix + input.len() as u64;
        }

        let channels = self.channels as usize;
        let input_frames = input.len() / channels;
        if input_frames == 0 {
            return prefix;
        }

        // 输出帧数 = 输入帧数 / speed（speed > 1 → 输出更短即更快）
        let exact_frames = input_frames as f64 / f64::from(self.speed) + self.frame_fraction;
        let output_frames = exact_frames.floor() as usize;
        self.frame_fraction = exact_frames - output_frames as f64;
        if output_frames == 0 {
            return prefix;
        }

        let start = output.len();
        output.resize(start + output_frames * channels, 0.0);
        self.stretch.process(input, &mut output[start..]);
        prefix + input.len() as u64
    }
}

#[cfg(test)]
#[path = "tests/tempo.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/automix_tempo.rs"]
mod automix_tests;
