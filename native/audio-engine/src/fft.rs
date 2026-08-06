use parking_lot::Mutex;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// 每次 FFT 的样本数
const FFT_SIZE: usize = 2048;
/// FFT 输入采样率
const FFT_SAMPLE_RATE: u32 = 48_000;
/// 输出频段数
const OUTPUT_BINS: usize = 128;
/// 分析频率范围
const MIN_FREQ: f32 = 80.0;
const MAX_FREQ: f32 = 2000.0;
/// 环形缓冲区最大样本数
const MAX_BUFFER_SIZE: usize = 8192;

/// FFT 频谱分析器，接收交织双声道样本并输出频谱数据
pub struct FftAnalyzer {
    /// 双声道样本环形缓冲区（由播放线程写入）
    sample_buffer: Mutex<StereoSampleBuffer>,
    /// 是否接收样本并执行频谱分析
    enabled: AtomicBool,
    /// 缓存的 FFT 计划（避免每次分析时重建）
    fft_plan: Arc<dyn Fft<f32>>,
    /// 预计算的 Hamming 窗，避免每次分析重复计算三角函数
    window: Vec<f32>,
    /// 预分配的 FFT 工作缓冲区（避免每次 analyze 分配）
    work: Mutex<FftWorkBuffers>,
}

struct StereoSampleBuffer {
    left: Vec<f32>,
    right: Vec<f32>,
    write_pos: usize,
    len: usize,
}

/// 预分配的 FFT 工作缓冲区
struct FftWorkBuffers {
    windowed_l: Vec<Complex<f32>>,
    windowed_r: Vec<Complex<f32>>,
    output_l: Vec<f32>,
    output_r: Vec<f32>,
}

impl FftAnalyzer {
    pub fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft_plan = planner.plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE)
            .map(|i| {
                0.54 - 0.46
                    * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos()
            })
            .collect();

        Self {
            sample_buffer: Mutex::new(StereoSampleBuffer {
                left: vec![0.0; MAX_BUFFER_SIZE],
                right: vec![0.0; MAX_BUFFER_SIZE],
                write_pos: 0,
                len: 0,
            }),
            enabled: AtomicBool::new(false),
            fft_plan,
            window,
            work: Mutex::new(FftWorkBuffers {
                windowed_l: vec![Complex::new(0.0, 0.0); FFT_SIZE],
                windowed_r: vec![Complex::new(0.0, 0.0); FFT_SIZE],
                output_l: vec![0.0; OUTPUT_BINS],
                output_r: vec![0.0; OUTPUT_BINS],
            }),
        }
    }

    /// 直接从交织立体声样本推入（由播放线程调用），一次遍历无需中间分配
    pub fn push_interleaved_samples(&self, interleaved: &[f32]) {
        let mut buffer = self.sample_buffer.lock();
        for pair in interleaved.chunks_exact(2) {
            let write_pos = buffer.write_pos;
            buffer.left[write_pos] = pair[0];
            buffer.right[write_pos] = pair[1];
            buffer.write_pos = (write_pos + 1) % MAX_BUFFER_SIZE;
            buffer.len = (buffer.len + 1).min(MAX_BUFFER_SIZE);
        }
    }

    /// 设置分析开关，启用时丢弃关闭前残留的数据
    pub fn set_enabled(&self, enabled: bool) {
        let was_enabled = self.enabled.swap(enabled, Ordering::Relaxed);
        if enabled && !was_enabled {
            self.reset();
        }
    }

    /// 是否启用频谱分析
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 应用预计算的 Hamming 窗
    fn apply_window(&self, samples: &[f32], start: usize, windowed: &mut [Complex<f32>]) {
        for (i, output) in windowed.iter_mut().enumerate() {
            let sample = samples[(start + i) % MAX_BUFFER_SIZE];
            *output = Complex::new(sample * self.window[i], 0.0);
        }
    }

    /// 转化为 dB 并归一化到 [0, 1]
    fn to_normalized_db(&self, avg: f32) -> f32 {
        let db = 20.0 * (avg + 1e-10).log10();
        ((db + 60.0) / 60.0).clamp(0.0, 1.0)
    }

    /// 计算频谱，返回左右声道 (ldata, rdata) 各 OUTPUT_BINS 个值，范围 [0.0, 1.0]
    pub fn analyze(&self) -> (Vec<f32>, Vec<f32>) {
        let buffer = self.sample_buffer.lock();
        if buffer.len < FFT_SIZE {
            return (vec![0.0; OUTPUT_BINS], vec![0.0; OUTPUT_BINS]);
        }

        // 取最新的 FFT_SIZE 个样本
        let start = (buffer.write_pos + MAX_BUFFER_SIZE - FFT_SIZE) % MAX_BUFFER_SIZE;

        let mut work = self.work.lock();

        // 应用 Hamming 窗（复用预分配的 windowed 缓冲区）
        self.apply_window(&buffer.left, start, &mut work.windowed_l);
        self.apply_window(&buffer.right, start, &mut work.windowed_r);

        // 释放 sample_buffer 锁（后续计算不需要它）
        drop(buffer);

        // 执行 FFT（使用缓存的计划，原地处理）
        self.fft_plan.process(&mut work.windowed_l);
        self.fft_plan.process(&mut work.windowed_r);

        // 将频率段映射到输出频段
        let freq_per_bin = FFT_SAMPLE_RATE as f32 / FFT_SIZE as f32;
        let min_bin = (MIN_FREQ / freq_per_bin).floor() as usize;
        let max_bin = ((MAX_FREQ / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

        if min_bin >= max_bin {
            work.output_l.iter_mut().for_each(|v| *v = 0.0);
            work.output_r.iter_mut().for_each(|v| *v = 0.0);
            return (work.output_l.clone(), work.output_r.clone());
        }

        // 使用对数间距分配输出频段
        let log_min = MIN_FREQ.ln();
        let log_max = MAX_FREQ.ln();

        for i in 0..OUTPUT_BINS {
            let freq_lo = (log_min + (log_max - log_min) * i as f32 / OUTPUT_BINS as f32).exp();
            let freq_hi =
                (log_min + (log_max - log_min) * (i + 1) as f32 / OUTPUT_BINS as f32).exp();

            let bin_lo = ((freq_lo / freq_per_bin).floor() as usize).max(min_bin);
            let bin_hi = ((freq_hi / freq_per_bin).ceil() as usize).min(max_bin);

            if bin_lo >= bin_hi {
                work.output_l[i] = 0.0;
                work.output_r[i] = 0.0;
                continue;
            }

            // 取该范围内的平均幅度（直接从 windowed 的前半部分计算，跳过 magnitudes 中间 Vec）
            let mut sums: (f32, f32) = (0.0, 0.0);
            for j in bin_lo..bin_hi {
                sums.0 += work.windowed_l[j].norm() / FFT_SIZE as f32;
                sums.1 += work.windowed_r[j].norm() / FFT_SIZE as f32;
            }
            let avgs = (
                sums.0 / (bin_hi - bin_lo) as f32,
                sums.1 / (bin_hi - bin_lo) as f32,
            );

            // 转为 dB 并归一化到 [0, 1]
            work.output_l[i] = self.to_normalized_db(avgs.0);
            work.output_r[i] = self.to_normalized_db(avgs.1);
        }

        (work.output_l.clone(), work.output_r.clone())
    }

    /// 重置样本缓冲区（例如 seek 时）
    pub fn reset(&self) {
        let mut buffer = self.sample_buffer.lock();
        buffer.write_pos = 0;
        buffer.len = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interleaved_samples_wrap_without_mixing_channels() {
        let analyzer = FftAnalyzer::new();
        let samples: Vec<f32> = (0..MAX_BUFFER_SIZE + 16)
            .flat_map(|i| [i as f32, -(i as f32)])
            .collect();

        analyzer.push_interleaved_samples(&samples);

        let buffer = analyzer.sample_buffer.lock();
        assert_eq!(buffer.len, MAX_BUFFER_SIZE);
        assert_eq!(buffer.write_pos, 16);
        let latest = (buffer.write_pos + MAX_BUFFER_SIZE - 1) % MAX_BUFFER_SIZE;
        assert_eq!(buffer.left[latest], (MAX_BUFFER_SIZE + 15) as f32);
        assert_eq!(buffer.right[latest], -((MAX_BUFFER_SIZE + 15) as f32));
    }

    #[test]
    fn reset_discards_buffered_samples() {
        let analyzer = FftAnalyzer::new();
        analyzer.push_interleaved_samples(&[0.5, -0.5, 0.25, -0.25]);

        analyzer.reset();

        let buffer = analyzer.sample_buffer.lock();
        assert_eq!(buffer.len, 0);
        assert_eq!(buffer.write_pos, 0);
    }

    #[test]
    fn fixed_sample_rate_maps_tone_to_expected_band() {
        let analyzer = FftAnalyzer::new();
        let frequency = 1_000.0;
        let samples: Vec<f32> = (0..FFT_SIZE)
            .flat_map(|i| {
                let phase =
                    2.0 * std::f32::consts::PI * frequency * i as f32 / FFT_SAMPLE_RATE as f32;
                let sample = phase.sin();
                [sample, sample]
            })
            .collect();

        analyzer.push_interleaved_samples(&samples);
        let (left, right) = analyzer.analyze();
        let peak = left
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.total_cmp(b))
            .map(|(index, _)| index)
            .unwrap();
        let expected = ((frequency.ln() - MIN_FREQ.ln()) / (MAX_FREQ.ln() - MIN_FREQ.ln())
            * OUTPUT_BINS as f32) as usize;

        assert!(
            peak.abs_diff(expected) <= 1,
            "peak={peak}, expected={expected}"
        );
        assert_eq!(left, right);
    }
}
