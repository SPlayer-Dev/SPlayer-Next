use anyhow::{ensure, Result};
use ort::{session::Session, value::Tensor};

/// 使用官方三十秒上下文与六帧边界拼接节拍预测
/// @param session - 已校验的节拍模型
/// @param spectrogram - 每帧一百二十八维的梅尔谱
/// @returns 交错排列的拍点与重拍预测
pub fn run(session: &mut Session, spectrogram: &[f32]) -> Result<Vec<f32>> {
    ensure!(spectrogram.len().is_multiple_of(128), "梅尔谱长度无效");
    let count = spectrogram.len() / 128;
    ensure!((1488..=2002).contains(&count), "节拍窗口长度无效");
    let mut output = vec![-1000.0; count * 2];
    let mut starts: Vec<isize> = (-6..count as isize - 6).step_by(1488).collect();
    if count > 1488 {
        *starts.last_mut().unwrap() = count as isize - 1494;
    }
    for start in starts.into_iter().rev() {
        let left = start.max(0) as usize;
        let right = (start + 1500).min(count as isize) as usize;
        let mut fixed = vec![0.0; 1500 * 128];
        let offset = (left as isize - start) as usize * 128;
        fixed[offset..offset + (right - left) * 128]
            .copy_from_slice(&spectrogram[left * 128..right * 128]);
        let predictions = session
            .run(ort::inputs!["spectrogram" => Tensor::from_array(([1, 1500, 128], fixed))?])?;
        for lane in 0..2 {
            let (_, values) = predictions[lane].try_extract_tensor::<f32>()?;
            ensure!(values.len() == 1500, "节拍输出长度不匹配");
            for frame in 6..1494 {
                output[(start + frame as isize) as usize * 2 + lane] = values[frame];
            }
        }
    }
    Ok(output)
}
