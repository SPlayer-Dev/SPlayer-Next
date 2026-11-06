use anyhow::{ensure, Result};
use std::fs;
use std::sync::Arc;

/// 当前或下一曲的有限分离窗口，三路双声道按帧排列
pub struct StemWindow {
    samples: Vec<f32>,
    start: f64,
    frames: usize,
}

impl StemWindow {
    /// 在控制线程核验并载入分离结果，不在音频回调访问磁盘
    /// @param path - 44100 Hz 六通道浮点窗口
    /// @param start - 相对本次解码起点的秒数
    /// @param frames - 有效双声道帧数
    /// @returns 当前窗口的共享只读数据
    pub fn load(path: &str, start: f64, frames: u32) -> Result<Arc<Self>> {
        ensure!(
            start.is_finite() && (88_200..=1_058_444).contains(&frames),
            "无效的声部窗口"
        );
        ensure!(
            fs::metadata(path)?.len() == u64::from(frames) * 24,
            "声部文件长度不匹配"
        );
        let raw = fs::read(path)?;
        let samples: Vec<f32> = raw
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect();
        ensure!(
            samples.iter().all(|sample| sample.is_finite()),
            "声部文件含无效采样"
        );
        Ok(Arc::new(Self {
            samples,
            start,
            frames: frames as usize,
        }))
    }

    /// 重采样到当前输出格式，窗口外补零并交给相同的后续 DSP 链路
    /// @param offset - 从本次解码起点累计的交错样本数
    /// @param count - 当前块的交错样本数
    /// @param sample_rate - 输出采样率
    /// @param channels - 输出声道数
    /// @returns 鼓、贝斯和人声的交错样本
    pub fn read(
        &self,
        offset: u64,
        count: usize,
        sample_rate: u32,
        channels: u16,
    ) -> Option<Box<[Vec<f32>; 3]>> {
        let channels = usize::from(channels);
        let time = offset as f64 / channels as f64 / f64::from(sample_rate);
        if time + count as f64 / channels as f64 / f64::from(sample_rate) < self.start - 10.0
            || time > self.start + self.frames as f64 / 44_100.0 + 0.1
        {
            return None;
        }
        let mut result = Box::new(std::array::from_fn(|_| vec![0.0; count]));
        for frame in 0..count / channels {
            let position = ((offset / channels as u64 + frame as u64) as f64
                / f64::from(sample_rate)
                - self.start)
                * 44_100.0;
            if position < 0.0 || position >= (self.frames - 1) as f64 {
                continue;
            }
            let index = position.floor() as usize;
            let fraction = (position - index as f64) as f32;
            let edge_gain = (position / 4410.0)
                .min((self.frames as f64 - 1.0 - position) / 4410.0)
                .clamp(0.0, 1.0) as f32;
            for (stem, output) in result.iter_mut().enumerate() {
                for channel in 0..channels {
                    let lane = if channels == 1 { 0 } else { channel.min(1) };
                    let value = |row: usize| {
                        if channels == 1 {
                            (self.samples[row * 6 + stem * 2]
                                + self.samples[row * 6 + stem * 2 + 1])
                                * 0.5
                        } else {
                            self.samples[row * 6 + stem * 2 + lane]
                        }
                    };
                    output[frame * channels + channel] =
                        (value(index) * (1.0 - fraction) + value(index + 1) * fraction) * edge_gain;
                }
            }
        }
        Some(result)
    }

    /// 检查处理位置是否已越过有限窗口，以便及时释放 PCM
    /// @param offset - 本次解码累计的交错样本数
    /// @param sample_rate - 输出采样率
    /// @param channels - 输出声道数
    /// @returns 窗口已结束时为 true
    pub fn finished(&self, offset: u64, sample_rate: u32, channels: u16) -> bool {
        offset as f64 / f64::from(channels) / f64::from(sample_rate)
            > self.start + self.frames as f64 / 44_100.0 + 0.1
    }
}
