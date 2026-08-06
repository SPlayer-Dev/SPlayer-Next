//! 实时响度分析器，基于 RMS 动态计算归一化增益。
//!
//! 用于没有 ReplayGain 标签的音频（如在线歌曲），在解码过程中实时测量响度，
//! 自动将音量归一化到目标响度水平。

/// 目标 RMS 响度（线性值），约 -14 dBFS
const TARGET_RMS: f32 = 0.2;

/// 正常 RMS 窗口时长（秒）
const WINDOW_DURATION_SECS: f32 = 0.4;

/// 初始快速收敛窗口时长（秒），让开头快速获得增益
const INITIAL_WINDOW_DURATION_SECS: f32 = 0.1;

/// 初始快速收敛的增益平滑因子
const INITIAL_SMOOTHING: f32 = 0.4;

/// 正常增益平滑因子
const NORMAL_SMOOTHING: f32 = 0.08;

/// 最大增益上限（防止静音段放大噪声）
const MAX_GAIN: f32 = 3.0;

/// 最小增益下限
const MIN_GAIN: f32 = 0.1;

/// 峰值保护余量，给后续 EQ 和设备转换留一点空间
const PEAK_HEADROOM: f32 = 0.95;

/// 初始快速收敛阶段的窗口数
const INITIAL_WINDOWS: u32 = 3;

/// 实时响度分析器
pub struct LoudnessAnalyzer {
    /// 正常窗口的交错样本数
    window_size: usize,
    /// 初始窗口的交错样本数
    initial_window_size: usize,
    /// 平方和累加器
    sum_squares: f64,
    /// 当前窗口内的采样数
    sample_count: usize,
    /// 平滑后的当前增益
    current_gain: f32,
    /// 是否有 ReplayGain 标签（有则跳过实时分析）
    has_replay_gain: bool,
    /// 已完成的窗口计数（用于区分初始收敛和稳态）
    windows_completed: u32,
}

impl LoudnessAnalyzer {
    /// 按目标采样率/声道数推算窗口尺寸
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        let samples_per_sec = sample_rate as f32 * channels as f32;
        Self {
            window_size: (samples_per_sec * WINDOW_DURATION_SECS) as usize,
            initial_window_size: (samples_per_sec * INITIAL_WINDOW_DURATION_SECS) as usize,
            sum_squares: 0.0,
            sample_count: 0,
            current_gain: 1.0,
            has_replay_gain: false,
            windows_completed: 0,
        }
    }

    /// 标记该曲目已有 ReplayGain 标签，跳过实时分析
    pub fn set_has_replay_gain(&mut self, has: bool) {
        self.has_replay_gain = has;
    }

    /// 输入一批采样（交错格式），更新响度测量并返回当前增益
    pub fn process(&mut self, samples: &[f32]) -> f32 {
        if self.has_replay_gain {
            return 1.0;
        }

        let mut peak = 0.0_f32;
        for &sample in samples {
            peak = peak.max(sample.abs());
            self.sum_squares += (sample as f64) * (sample as f64);
            self.sample_count += 1;
        }

        // 初始阶段用更小的窗口快速收敛
        let is_initial = self.windows_completed < INITIAL_WINDOWS;
        let window = if is_initial {
            self.initial_window_size
        } else {
            self.window_size
        };
        let smoothing = if is_initial {
            INITIAL_SMOOTHING
        } else {
            NORMAL_SMOOTHING
        };

        if self.sample_count >= window {
            let rms = (self.sum_squares / self.sample_count as f64).sqrt() as f32;

            if rms > 1e-6 {
                let target_gain = (TARGET_RMS / rms).clamp(MIN_GAIN, MAX_GAIN);
                self.current_gain += smoothing * (target_gain - self.current_gain);
            }

            self.sum_squares = 0.0;
            self.sample_count = 0;
            self.windows_completed = self.windows_completed.saturating_add(1);
        }

        if peak > 1e-6 {
            self.current_gain = self.current_gain.min(PEAK_HEADROOM / peak);
        }

        self.current_gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_gain_before_loud_transient_clips() {
        let mut analyzer = LoudnessAnalyzer::new(48000, 2);

        let initial_quiet = vec![0.04; 4800 * 2];
        for _ in 0..3 {
            analyzer.process(&initial_quiet);
        }
        let normal_quiet = vec![0.04; 19200 * 2];
        analyzer.process(&normal_quiet);

        let loud = vec![0.8; 960 * 2];
        let gain = analyzer.process(&loud);

        assert!(gain * 0.8 <= 0.95);
    }
}
