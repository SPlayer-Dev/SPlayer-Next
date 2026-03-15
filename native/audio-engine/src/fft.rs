use parking_lot::Mutex;
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Arc;

/// Number of samples per FFT frame
const FFT_SIZE: usize = 2048;
/// Number of output frequency bins
const OUTPUT_BINS: usize = 128;
/// Frequency range for analysis
const MIN_FREQ: f32 = 80.0;
const MAX_FREQ: f32 = 2000.0;

/// FFT analyzer that processes audio samples and produces frequency spectrum data
pub struct FftAnalyzer {
    /// Ring buffer of mono f32 samples (filled by decoder thread)
    pub sample_buffer: Arc<Mutex<Vec<f32>>>,
    /// Sample rate of the FFT input
    sample_rate: u32,
}

impl FftAnalyzer {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_buffer: Arc::new(Mutex::new(Vec::with_capacity(8192))),
            sample_rate,
        }
    }

    /// Get the shared sample buffer (pass to decoder for writing)
    pub fn buffer(&self) -> Arc<Mutex<Vec<f32>>> {
        Arc::clone(&self.sample_buffer)
    }

    /// Compute frequency spectrum from the current buffer.
    /// Returns a Vec of `OUTPUT_BINS` values in [0.0, 1.0].
    pub fn analyze(&self) -> Vec<f32> {
        let buf = self.sample_buffer.lock();
        if buf.len() < FFT_SIZE {
            return vec![0.0; OUTPUT_BINS];
        }

        // Take the latest FFT_SIZE samples
        let start = buf.len() - FFT_SIZE;
        let samples = &buf[start..];

        // Apply Hamming window
        let mut windowed: Vec<Complex<f32>> = samples
            .iter()
            .enumerate()
            .map(|(i, &s)| {
                let w = 0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos();
                Complex::new(s * w, 0.0)
            })
            .collect();

        // Perform FFT
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        fft.process(&mut windowed);

        // Convert to magnitude spectrum (only first half — positive frequencies)
        let magnitudes: Vec<f32> = windowed[..FFT_SIZE / 2]
            .iter()
            .map(|c| c.norm() / FFT_SIZE as f32)
            .collect();

        // Map frequency bins to output bins in the [MIN_FREQ, MAX_FREQ] range
        let freq_per_bin = self.sample_rate as f32 / FFT_SIZE as f32;
        let min_bin = (MIN_FREQ / freq_per_bin).floor() as usize;
        let max_bin = (MAX_FREQ / freq_per_bin).ceil() as usize;
        let max_bin = max_bin.min(magnitudes.len());

        if min_bin >= max_bin {
            return vec![0.0; OUTPUT_BINS];
        }

        // Use logarithmic spacing for output bins
        let log_min = MIN_FREQ.ln();
        let log_max = MAX_FREQ.ln();
        let mut output = Vec::with_capacity(OUTPUT_BINS);

        for i in 0..OUTPUT_BINS {
            let freq_lo = ((log_min + (log_max - log_min) * i as f32 / OUTPUT_BINS as f32).exp()) ;
            let freq_hi = ((log_min + (log_max - log_min) * (i + 1) as f32 / OUTPUT_BINS as f32).exp());

            let bin_lo = ((freq_lo / freq_per_bin).floor() as usize).max(min_bin);
            let bin_hi = ((freq_hi / freq_per_bin).ceil() as usize).min(max_bin);

            if bin_lo >= bin_hi {
                output.push(0.0);
                continue;
            }

            // Average magnitude in this range
            let sum: f32 = magnitudes[bin_lo..bin_hi].iter().sum();
            let avg = sum / (bin_hi - bin_lo) as f32;

            // Convert to dB scale and normalize to [0, 1]
            let db = 20.0 * (avg + 1e-10).log10();
            let normalized = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
            output.push(normalized);
        }

        output
    }

    /// Reset the sample buffer (e.g., on seek)
    pub fn reset(&self) {
        self.sample_buffer.lock().clear();
    }
}
