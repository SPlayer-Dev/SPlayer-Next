use std::fs::File;
use std::io::Write;
use std::time::Duration;

use anyhow::{ensure, Result};
use ffmpeg_audio::{sys::AVERROR_INVALIDDATA, AudioError, AudioReader, ResampleOptions, SeekMode};
use rustfft::{num_complex::Complex, FftPlanner};

const SAMPLE_RATE: usize = 22_050;
const FFT_SIZE: usize = 1024;
const CHROMA_FFT_SIZE: usize = 4096;
const HOP: usize = 441;
const MEL_BANDS: usize = 128;
const ANALYSIS_SECONDS: f64 = 40.0;
const STEM_SECONDS: f64 = 24.0;

pub(crate) struct AudioFeatures {
    pub start: f64,
    pub end: f64,
    pub first_audible: f64,
    pub last_audible: f64,
    pub mel: Vec<f32>,
    pub levels: Vec<f32>,
    pub chroma: Vec<f32>,
}

struct AudioWindow {
    start: f64,
    end: f64,
    first_audible: f64,
    last_audible: f64,
    pcm: Vec<f32>,
    levels: Vec<f32>,
}

/// 将赫兹转换为模型训练使用的 Slaney 梅尔刻度
/// @param hz - 频率，单位为赫兹
/// @returns 对应的梅尔刻度
fn hz_to_mel(hz: f64) -> f64 {
    if hz < 1000.0 {
        hz / (200.0 / 3.0)
    } else {
        15.0 + (hz / 1000.0).ln() / (6.4_f64.ln() / 27.0)
    }
}

/// 将 Slaney 梅尔刻度转换为赫兹
/// @param mel - 梅尔刻度
/// @returns 频率，单位为赫兹
fn mel_to_hz(mel: f64) -> f64 {
    if mel < 15.0 {
        mel * (200.0 / 3.0)
    } else {
        1000.0 * ((mel - 15.0) * (6.4_f64.ln() / 27.0)).exp()
    }
}

/// 计算 Beat This! 的归一化幅度梅尔谱，中心反射填充与官方前处理一致
/// @param mono - 22050 Hz 单声道采样
/// @returns 逐帧梅尔谱与每一百毫秒的归一化音级能量
fn spectral_features(mono: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let frames = mono.len() / HOP + 1;
    let corners: Vec<f64> = (0..MEL_BANDS + 2)
        .map(|index| {
            mel_to_hz(
                hz_to_mel(30.0)
                    + (hz_to_mel(11_000.0) - hz_to_mel(30.0)) * index as f64
                        / (MEL_BANDS + 1) as f64,
            )
        })
        .collect();
    let weights: Vec<Vec<(usize, f64)>> = (0..MEL_BANDS)
        .map(|band| {
            (0..=FFT_SIZE / 2)
                .filter_map(|bin| {
                    let hz = bin as f64 * SAMPLE_RATE as f64 / FFT_SIZE as f64;
                    let rising = (hz - corners[band]) / (corners[band + 1] - corners[band]);
                    let falling =
                        (corners[band + 2] - hz) / (corners[band + 2] - corners[band + 1]);
                    let weight = rising.min(falling).max(0.0);
                    (weight > 0.0).then_some((bin, weight))
                })
                .collect()
        })
        .collect();
    let window: Vec<f64> = (0..FFT_SIZE)
        .map(|index| 0.5 * (1.0 - (std::f64::consts::TAU * index as f64 / FFT_SIZE as f64).cos()))
        .collect();
    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
    let mut buffer = vec![Complex::new(0.0, 0.0); FFT_SIZE];
    let mut scratch = vec![Complex::new(0.0, 0.0); fft.get_inplace_scratch_len()];
    let mut magnitude = vec![0.0; FFT_SIZE / 2 + 1];
    let mut mel = Vec::with_capacity(frames * MEL_BANDS);
    let mut chroma = vec![0.0_f32; mono.len().div_ceil(SAMPLE_RATE / 10) * 12];
    for frame in 0..frames {
        for (index, sample) in buffer.iter_mut().enumerate() {
            let mut position = ((frame * HOP + index) as isize - (FFT_SIZE / 2) as isize).abs();
            if position >= mono.len() as isize {
                position = 2 * (mono.len() as isize - 1) - position;
            }
            *sample = Complex::new(mono[position as usize] * window[index] as f32, 0.0);
        }
        fft.process_with_scratch(&mut buffer, &mut scratch);
        for (bin, value) in magnitude.iter_mut().enumerate() {
            *value = f64::from(buffer[bin].norm()) / (FFT_SIZE as f64).sqrt();
        }
        for band in &weights {
            let energy: f64 = band
                .iter()
                .map(|(bin, weight)| magnitude[*bin] * weight)
                .sum();
            mel.push((1000.0 * energy.max(1e-10)).ln_1p() as f32);
        }
    }
    // 节拍模型的短窗不能分清低音半音，音级证据单独使用较长窗和谱峰插值
    let fft = FftPlanner::<f32>::new().plan_fft_forward(CHROMA_FFT_SIZE);
    buffer.resize(CHROMA_FFT_SIZE, Complex::new(0.0, 0.0));
    scratch.resize(fft.get_inplace_scratch_len(), Complex::new(0.0, 0.0));
    magnitude.resize(CHROMA_FFT_SIZE / 2 + 1, 0.0);
    let window: Vec<f32> = (0..CHROMA_FFT_SIZE)
        .map(|index| {
            0.5 * (1.0 - (std::f32::consts::TAU * index as f32 / CHROMA_FFT_SIZE as f32).cos())
        })
        .collect();
    for (frame, cell) in chroma.as_chunks_mut::<12>().0.iter_mut().enumerate() {
        let center = frame * (SAMPLE_RATE / 10) + SAMPLE_RATE / 20;
        for (index, sample) in buffer.iter_mut().enumerate() {
            let mut position = ((center + index) as isize - (CHROMA_FFT_SIZE / 2) as isize).abs();
            if position >= mono.len() as isize {
                position = 2 * (mono.len() as isize - 1) - position;
            }
            *sample = Complex::new(mono[position as usize] * window[index], 0.0);
        }
        fft.process_with_scratch(&mut buffer, &mut scratch);
        for (bin, value) in magnitude.iter_mut().enumerate() {
            *value = f64::from(buffer[bin].norm());
        }
        let floor = magnitude.iter().sum::<f64>() / magnitude.len() as f64 * 3.0;
        for bin in 1..magnitude.len() - 1 {
            let peak = magnitude[bin];
            if peak <= floor || peak <= magnitude[bin - 1] || peak <= magnitude[bin + 1] {
                continue;
            }
            let left = magnitude[bin - 1].max(1e-12).ln();
            let middle = peak.max(1e-12).ln();
            let right = magnitude[bin + 1].max(1e-12).ln();
            let offset = (0.5 * (left - right) / (left - 2.0 * middle + right)).clamp(-0.5, 0.5);
            let hz = (bin as f64 + offset) * SAMPLE_RATE as f64 / CHROMA_FFT_SIZE as f64;
            if !(80.0..=5000.0).contains(&hz) {
                continue;
            }
            let pitch = 69.0 + 12.0 * (hz / 440.0).log2();
            let lower = pitch.floor() as usize % 12;
            let fraction = pitch.fract() as f32;
            let weight = peak.sqrt() as f32;
            cell[lower] += weight * (1.0 - fraction);
            cell[(lower + 1) % 12] += weight * fraction;
        }
        let norm = cell.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm > 1e-8 {
            for value in cell {
                *value /= norm;
            }
        }
    }
    (mel, chroma)
}

/// 只解码曲目首部或尾部的有限窗口，不提取封面或载入整首音频
/// @param source - 本地或完整缓存的音频路径
/// @param start - 曲目或 CUE 子曲目的起点，单位为秒
/// @param end - 曲目或 CUE 子曲目的终点，省略时使用文件时长
/// @param tail - 是否分析尾部窗口
/// @param sample_rate - 当前分析模型所需的采样率
/// @param limit - 该处理阶段允许的最大窗口秒数
/// @returns 源时间范围、有声边界和双声道 PCM
fn decode_window(
    source: &str,
    start: f64,
    end: Option<f64>,
    tail: bool,
    sample_rate: usize,
    limit: f64,
) -> Result<AudioWindow> {
    ensure!(
        !source.contains("://"),
        "AutoMix 分析需要本地或已完成缓存的音源"
    );
    ensure!(start.is_finite() && start >= 0.0, "无效的分析起点");
    let mut reader =
        AudioReader::new(crate::decoder::input::AudioInput::new(File::open(source)?)?)?;
    let duration = reader
        .duration()
        .map(|value| value.as_secs_f64())
        .unwrap_or(0.0);
    let end = end.unwrap_or(duration).min(duration);
    ensure!(
        end.is_finite() && end - start >= 2.0,
        "音源没有可分析的有效时长"
    );
    let scan_start = if tail { start.max(end - limit) } else { start };
    let scan_end = end.min(scan_start + limit);
    // 无时间戳格式无法精确跳转时从头计数，保持分析窗口与播放源时间一致
    if scan_start > 0.0
        && reader
            .seek(Duration::from_secs_f64(scan_start), SeekMode::Accurate)
            .is_err()
    {
        reader = AudioReader::new(crate::decoder::input::AudioInput::new(File::open(source)?)?)?;
    }
    let mut converter = reader.build_resampler(
        ResampleOptions::new()
            .sample_rate(sample_rate as i32)
            .channels(2)
            .format::<f32>(),
    )?;
    let mut pcm = Vec::with_capacity((limit * sample_rate as f64) as usize * 2);
    let mut first_audible = None;
    let mut last_audible = scan_start;
    let mut levels = Vec::with_capacity((limit * 10.0) as usize);
    let mut level_energy = 0.0_f64;
    let mut level_samples = 0;
    let mut decoded_until = 0.0;
    loop {
        let frame = match reader.receive_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) | Err(AudioError::Eof) => break,
            // FLAC 尾部附加标签或最后一帧损坏，不应丢弃已经完整解出的曲尾
            Err(AudioError::FFmpeg(AVERROR_INVALIDDATA, _)) if decoded_until >= scan_end - 0.1 => {
                break
            }
            Err(error) => return Err(error.into()),
        };
        let position = frame
            .pts()
            .map(|time| time.as_secs_f64())
            .unwrap_or(decoded_until);
        decoded_until = position + frame.duration().as_secs_f64();
        converter.process::<f32>(Some(&frame))?;
        for (index, samples) in converter
            .output_as::<f32>()
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
        {
            let time = position + index as f64 / sample_rate as f64;
            if time < scan_start || time >= scan_end {
                continue;
            }
            ensure!(
                samples.iter().all(|sample| sample.is_finite()),
                "音源含无效采样"
            );
            pcm.extend_from_slice(samples);
            level_energy += (f64::from(samples[0]).powi(2) + f64::from(samples[1]).powi(2)) * 0.5;
            level_samples += 1;
            if level_samples == sample_rate / 10 {
                levels.push((level_energy / level_samples as f64).sqrt() as f32);
                level_energy = 0.0;
                level_samples = 0;
            }
            if samples[0].abs().max(samples[1].abs()) > 0.001 {
                first_audible.get_or_insert(time);
                last_audible = time + 1.0 / sample_rate as f64;
            }
        }
        if decoded_until >= scan_end {
            break;
        }
    }
    if level_samples > 0 {
        levels.push((level_energy / level_samples as f64).sqrt() as f32);
    }
    ensure!(pcm.len() >= sample_rate * 4, "可分析的音频样本不足");
    Ok(AudioWindow {
        start: scan_start,
        end: scan_start + pcm.len() as f64 / (sample_rate * 2) as f64,
        first_audible: first_audible.unwrap_or(scan_start),
        last_audible,
        pcm,
        levels,
    })
}

/// 提取节拍模型输入，不在主进程保留解码音频
/// @param source - 本地音源
/// @param start - 曲目起点秒数
/// @param end - 曲目终点秒数
/// @param tail - 是否读取曲尾
/// @returns 归一化梅尔谱、电平和源时间边界
pub(crate) fn analyze_audio(
    source: &str,
    start: f64,
    end: Option<f64>,
    tail: bool,
) -> Result<AudioFeatures> {
    let window = decode_window(source, start, end, tail, SAMPLE_RATE, ANALYSIS_SECONDS)?;
    let mono: Vec<f32> = window
        .pcm
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| (pair[0] + pair[1]) * 0.5)
        .collect();
    let (mel, chroma) = spectral_features(&mono);
    Ok(AudioFeatures {
        start: window.start,
        end: window.end,
        first_audible: window.first_audible,
        last_audible: window.last_audible,
        levels: window.levels,
        mel,
        chroma,
    })
}

/// 写出 Demucs 所需的有限双声道窗口，不依赖系统 FFmpeg
/// @param source - 本地音源
/// @param start - 曲目起点秒数
/// @param end - 曲目终点秒数
/// @param tail - 是否读取曲尾
/// @param target - 独立分析任务的临时文件
/// @returns 44100 Hz 双声道帧数
pub(crate) fn export_stem_window(
    source: &str,
    start: f64,
    end: Option<f64>,
    tail: bool,
    target: &str,
) -> Result<u32> {
    let window = decode_window(source, start, end, tail, 44_100, STEM_SECONDS)?;
    let mut file = std::io::BufWriter::new(File::create(target)?);
    for sample in &window.pcm {
        file.write_all(&sample.to_le_bytes())?;
    }
    file.flush()?;
    Ok((window.pcm.len() / 2) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_matches_the_model_floor_and_frame_count() {
        let (mel, chroma) = spectral_features(&vec![0.0; SAMPLE_RATE * 2]);
        assert_eq!(mel.len(), 101 * MEL_BANDS);
        assert!(mel.iter().all(|sample| (*sample - 1e-7).abs() < 1e-10));
        assert!(chroma.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn periodic_hann_places_a_tone_in_the_expected_mel_band() {
        let mono: Vec<f32> = (0..SAMPLE_RATE * 2)
            .map(|index| {
                (std::f64::consts::TAU * 440.0 * index as f64 / SAMPLE_RATE as f64).sin() as f32
            })
            .collect();
        let (mel, _) = spectral_features(&mono);
        let peak = mel[50 * MEL_BANDS..51 * MEL_BANDS]
            .iter()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(right.1))
            .unwrap()
            .0;
        assert!((14..22).contains(&peak), "{peak}");
    }

    #[test]
    fn chroma_distinguishes_semitones_and_preserves_octave_equivalence() {
        let features: Vec<Vec<f32>> = [0.0_f64, 1.0, 12.0]
            .iter()
            .map(|shift| {
                let mono: Vec<f32> = (0..SAMPLE_RATE * 2)
                    .map(|index| {
                        [48.0, 52.0, 55.0]
                            .iter()
                            .map(|note| {
                                let hz = 440.0 * 2.0_f64.powf((note + shift - 69.0) / 12.0);
                                (std::f64::consts::TAU * hz * index as f64 / SAMPLE_RATE as f64)
                                    .sin() as f32
                                    / 3.0
                            })
                            .sum()
                    })
                    .collect();
                spectral_features(&mono).1[10 * 12..11 * 12].to_vec()
            })
            .collect();
        let shifted = features[0]
            .iter()
            .zip(&features[1])
            .map(|(left, right)| left * right)
            .sum::<f32>();
        let octave = features[0]
            .iter()
            .zip(&features[2])
            .map(|(left, right)| left * right)
            .sum::<f32>();
        assert!(shifted < 0.2, "半音偏移不应被视为同一组音级: {shifted}");
        assert!(octave > 0.98, "八度关系不应改变音级证据: {octave}");
    }
}
