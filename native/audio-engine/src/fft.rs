use parking_lot::Mutex;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

/// 每次 FFT 的样本数
const FFT_SIZE: usize = 2048;
/// 输出频段数
const OUTPUT_BINS: usize = 128;
/// 分析频率范围
const MIN_FREQ: f32 = 80.0;
const MAX_FREQ: f32 = 2000.0;
/// 环形缓冲区最大样本数
const MAX_BUFFER_SIZE: usize = 8192;

/// FFT 频谱分析器，接收单声道样本并输出频谱数据
pub struct FftAnalyzer {
    /// 单声道 f32 样本环形缓冲区（由播放线程写入）
    sample_buffer: Mutex<Vec<f32>>,
    /// FFT 输入采样率
    sample_rate: u32,
    /// 缓存的 FFT 计划（避免每次分析时重建）
    fft_plan: Arc<dyn Fft<f32>>,
    /// 预分配的 FFT 工作缓冲区（避免每次 analyze 分配）
    work: Mutex<FftWorkBuffers>,
}

/// 预分配的 FFT 工作缓冲区
struct FftWorkBuffers {
    windowed: Vec<Complex<f32>>,
    output: Vec<f32>,
}

impl FftAnalyzer {
    pub fn new(sample_rate: u32) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft_plan = planner.plan_fft_forward(FFT_SIZE);

        Self {
            sample_buffer: Mutex::new(Vec::with_capacity(MAX_BUFFER_SIZE)),
            sample_rate,
            fft_plan,
            work: Mutex::new(FftWorkBuffers {
                windowed: vec![Complex::new(0.0, 0.0); FFT_SIZE],
                output: vec![0.0; OUTPUT_BINS],
            }),
        }
    }

    /// 推入解码后的单声道样本（由播放线程调用）
    pub fn push_samples(&self, samples: &[f32]) {
        let mut buf = self.sample_buffer.lock();
        buf.extend_from_slice(samples);
        // 只保留最新的样本
        if buf.len() > MAX_BUFFER_SIZE {
            let drain_count = buf.len() - MAX_BUFFER_SIZE;
            buf.drain(..drain_count);
        }
    }

    /// 计算频谱，返回 OUTPUT_BINS 个值，范围 [0.0, 1.0]
    pub fn analyze(&self) -> Vec<f32> {
        let buf = self.sample_buffer.lock();
        if buf.len() < FFT_SIZE {
            return vec![0.0; OUTPUT_BINS];
        }

        // 取最新的 FFT_SIZE 个样本
        let start = buf.len() - FFT_SIZE;
        let samples = &buf[start..];

        let mut work = self.work.lock();

        // 应用 Hamming 窗（复用预分配的 windowed 缓冲区）
        for (i, (&s, w)) in samples.iter().zip(work.windowed.iter_mut()).enumerate() {
            let ham = 0.54
                - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos();
            *w = Complex::new(s * ham, 0.0);
        }

        // 释放 sample_buffer 锁（后续计算不需要它）
        drop(buf);

        // 执行 FFT（使用缓存的计划，原地处理）
        self.fft_plan.process(&mut work.windowed);

        // 将频率段映射到输出频段
        let freq_per_bin = self.sample_rate as f32 / FFT_SIZE as f32;
        let min_bin = (MIN_FREQ / freq_per_bin).floor() as usize;
        let max_bin = ((MAX_FREQ / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

        if min_bin >= max_bin {
            work.output.iter_mut().for_each(|v| *v = 0.0);
            return work.output.clone();
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
                work.output[i] = 0.0;
                continue;
            }

            // 取该范围内的平均幅度（直接从 windowed 的前半部分计算，跳过 magnitudes 中间 Vec）
            let mut sum: f32 = 0.0;
            for j in bin_lo..bin_hi {
                sum += work.windowed[j].norm() / FFT_SIZE as f32;
            }
            let avg = sum / (bin_hi - bin_lo) as f32;

            // 转为 dB 并归一化到 [0, 1]
            let db = 20.0 * (avg + 1e-10).log10();
            work.output[i] = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
        }

        work.output.clone()
    }

    /// 重置样本缓冲区（例如 seek 时）
    pub fn reset(&self) {
        let mut buf = self.sample_buffer.lock();
        buf.clear();
        buf.shrink_to(MAX_BUFFER_SIZE);
    }
}
