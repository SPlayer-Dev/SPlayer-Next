use super::spectral::{Spectral, CELLS, SIZE};
use anyhow::{ensure, Result};
use ort::{session::Session, value::Tensor};

pub const FRAMES: usize = 172032;

/// 沿用原精度模型与分段规则，及时合并并释放每段预测
/// @param session - 已校验的分离模型
/// @param interleaved - 四万四千一百赫兹双声道交错采样
/// @returns 逐帧六通道声部与每百毫秒的人声电平
pub fn run(session: &mut Session, interleaved: &[f32]) -> Result<(Vec<f32>, Vec<f32>)> {
    ensure!(interleaved.len().is_multiple_of(2), "声部输入声道无效");
    let count = interleaved.len() / 2;
    ensure!((88_200..=1_058_444).contains(&count), "声部窗口长度无效");
    let reference: Vec<f32> = interleaved
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| (pair[0] + pair[1]) * 0.5)
        .collect();
    let mean = (reference.iter().map(|value| f64::from(*value)).sum::<f64>() / count as f64) as f32;
    let std = (reference
        .iter()
        .map(|value| f64::from(*value - mean).powi(2))
        .sum::<f64>()
        / (count - 1) as f64)
        .sqrt()
        .max(1e-8) as f32;
    let mut result = vec![0.0; count * 6];
    let mut sums = vec![0.0; count];
    let spectral = Spectral::new();
    for offset in (0..count).step_by(FRAMES * 3 / 4) {
        let length = FRAMES.min(count - offset);
        let trim = (FRAMES - length) / 2;
        let start = offset as isize - trim as isize;
        let left = start.max(0) as usize;
        let right = (start + FRAMES as isize).min(count as isize) as usize;
        let mut fixed = vec![0.0; FRAMES * 2];
        for channel in 0..2 {
            for frame in left..right {
                fixed[channel * FRAMES + (frame as isize - start) as usize] =
                    (interleaved[frame * 2 + channel] - mean) / std;
            }
        }
        let spectrum = spectral.forward(&fixed);
        let predictions = session.run(ort::inputs![
            "waveform" => Tensor::from_array(([1, 2, FRAMES], fixed))?,
            "spectrum" => Tensor::from_array(([1, 4, SIZE / 2, CELLS], spectrum))?,
        ])?;
        let (_, temporal) = predictions[0].try_extract_tensor::<f32>()?;
        let (_, frequency) = predictions[1].try_extract_tensor::<f32>()?;
        ensure!(
            temporal.len() == 8 * FRAMES && frequency.len() == 16 * (SIZE / 2) * CELLS,
            "声部预测尺寸无效"
        );
        let output = spectral.reconstruct(frequency, temporal);
        for frame in 0..length {
            let weight = ((frame + 1).min(FRAMES - frame)) as f32 / (FRAMES / 2) as f32;
            sums[offset + frame] += weight;
            for lane in 0..6 {
                result[(offset + frame) * 6 + lane] +=
                    output[lane * FRAMES + trim + frame] * weight;
            }
        }
    }
    for (frame, channels) in result.as_chunks_mut::<6>().0.iter_mut().enumerate() {
        for value in channels {
            *value = *value / sums[frame] * std + mean;
        }
    }
    ensure!(
        result.iter().all(|value| value.is_finite()),
        "声部包含无效采样"
    );
    let vocals = result
        .chunks(4410 * 6)
        .map(|chunk| {
            let energy = chunk
                .as_chunks::<6>()
                .0
                .iter()
                .map(|frame| f64::from(frame[4]).powi(2) + f64::from(frame[5]).powi(2))
                .sum::<f64>();
            (energy / (chunk.len() / 3) as f64).sqrt() as f32
        })
        .collect();
    Ok((result, vocals))
}
