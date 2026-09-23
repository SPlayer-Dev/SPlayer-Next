use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use crossbeam_queue::ArrayQueue;

use super::buffer::Shared;
use super::source::DecoderSampleReader;
use crate::dsp::fft::FftAnalyzer;

/// 混音后的柔性峰值保护，避免两首相关音频在等功率曲线中硬削波
fn soft_ceiling(sample: f32) -> f32 {
    let level = sample.abs();
    if level <= 0.95 {
        return sample;
    }
    (0.95 + 0.05 * (1.0 - (-(level - 0.95) / 0.05).exp())).copysign(sample)
}

/// 待提交到输出回调的过渡命令，所有内存均在控制线程分配
struct TransitionCommand {
    next: Box<DecoderSampleReader>,
    intro_frame: Vec<f32>,
    earliest_sample: u64,
    latest_sample: u64,
    fade_samples: u64,
    completed: Arc<AtomicBool>,
}

struct ActiveTransition {
    command: TransitionCommand,
    elapsed: u64,
    faded: u64,
    quiet_samples: u64,
    intro_scanned: u64,
    intro_done: bool,
    head_index: usize,
    gain_a: f32,
    gain_b: f32,
}

struct RetiredSource {
    _reader: Box<DecoderSampleReader>,
    _intro_frame: Vec<f32>,
}

/// 控制线程向同一条输出流提交下一曲，并回收退役的读取器
#[derive(Clone)]
pub struct TransitionControl {
    commands: Arc<ArrayQueue<TransitionCommand>>,
    retired: Arc<ArrayQueue<RetiredSource>>,
}

impl TransitionControl {
    /// 将已就绪的下一曲提交到实时输出回调
    /// @param shared - 下一曲的 PCM 缓冲
    /// @param fft - 输出频谱分析器
    /// @param earliest_sample - 允许开始过渡的最早输出样本数
    /// @param latest_sample - 必须开始过渡的最晚输出样本数
    /// @param fade_samples - 交叉过渡的输出样本数
    /// @returns 回调完成交接后置位的标志
    pub fn queue(
        &self,
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        earliest_sample: u64,
        latest_sample: u64,
        fade_samples: u64,
    ) -> Result<Arc<AtomicBool>> {
        let completed = Arc::new(AtomicBool::new(false));
        let command = TransitionCommand {
            intro_frame: vec![0.0; shared.channels() as usize],
            next: Box::new(DecoderSampleReader::new(shared, fft)),
            earliest_sample,
            latest_sample,
            fade_samples: fade_samples.max(1),
            completed: Arc::clone(&completed),
        };
        self.commands
            .push(command)
            .map_err(|_| anyhow!("已有播放过渡正在等待提交"))?;
        Ok(completed)
    }

    /// 在控制线程回收已经退出混音的旧音源
    pub fn drain_retired(&self) {
        while self.retired.pop().is_some() {}
    }
}

/// 一条设备输出流中的双槽位混音源
pub struct TransitionSource {
    active: Box<DecoderSampleReader>,
    transition: Option<ActiveTransition>,
    control: TransitionControl,
    channels: u64,
    quiet_window_samples: u64,
    max_intro_samples: u64,
}

impl TransitionSource {
    pub fn new(shared: Arc<Shared>, fft: Arc<FftAnalyzer>) -> Self {
        let channels = u64::from(shared.channels());
        let quiet_window_samples =
            u64::from(shared.sample_rate()) * u64::from(shared.channels()) / 5;
        let max_intro_samples = u64::from(shared.sample_rate()) * u64::from(shared.channels()) * 2;
        Self {
            active: Box::new(DecoderSampleReader::new(shared, fft)),
            transition: None,
            control: TransitionControl {
                commands: Arc::new(ArrayQueue::new(1)),
                retired: Arc::new(ArrayQueue::new(1)),
            },
            channels,
            quiet_window_samples,
            max_intro_samples,
        }
    }

    pub fn control(&self) -> TransitionControl {
        self.control.clone()
    }

    pub fn begin_callback(&mut self) {
        self.active.begin_callback();
        if let Some(transition) = &mut self.transition {
            transition.command.next.begin_callback();
        }
    }

    fn finish_transition(&mut self) {
        let Some(transition) = self.transition.take() else {
            return;
        };
        let old = std::mem::replace(&mut self.active, transition.command.next);
        let _ = self.control.retired.push(RetiredSource {
            _reader: old,
            _intro_frame: transition.command.intro_frame,
        });
        transition.command.completed.store(true, Ordering::Release);
    }
}

impl Iterator for TransitionSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.transition.is_none() {
            if let Some(command) = self.control.commands.pop() {
                let mut next = ActiveTransition {
                    command,
                    elapsed: 0,
                    faded: 0,
                    quiet_samples: 0,
                    intro_scanned: 0,
                    intro_done: false,
                    head_index: 0,
                    gain_a: 1.0,
                    gain_b: 0.0,
                };
                next.command.next.begin_callback();
                self.transition = Some(next);
            }
        }

        let Some(transition) = &mut self.transition else {
            return self.active.next();
        };
        let a = self.active.next();
        transition.elapsed = transition.elapsed.saturating_add(1);
        let frame_start = (transition.elapsed - 1) % self.channels == 0;
        if !transition.intro_done && frame_start {
            let mut audible = false;
            let mut complete = true;
            for sample in &mut transition.command.intro_frame {
                let Some(value) = transition.command.next.next() else {
                    complete = false;
                    break;
                };
                if transition.command.next.is_underrun() {
                    complete = false;
                    break;
                }
                *sample = value;
                audible |= value.abs() >= 0.0015;
            }
            if complete {
                transition.intro_scanned += self.channels;
                let intro_limit = self
                    .max_intro_samples
                    .min(transition.command.latest_sample.max(self.channels));
                transition.intro_done = audible || transition.intro_scanned >= intro_limit;
            }
        }
        if transition.elapsed < transition.command.earliest_sample {
            return a;
        }

        let sample = a.unwrap_or(0.0);
        if sample.abs() < 0.005 && !self.active.is_underrun() {
            transition.quiet_samples += 1;
        } else {
            transition.quiet_samples = 0;
        }
        let start = transition.faded > 0
            || (frame_start
                && (transition.quiet_samples >= self.quiet_window_samples
                    || transition.elapsed >= transition.command.latest_sample
                    || a.is_none()));
        if !start || !transition.intro_done {
            return a;
        }

        let from_intro = transition.head_index < transition.command.intro_frame.len();
        let b = if from_intro {
            let sample = transition.command.intro_frame[transition.head_index];
            transition.head_index += 1;
            sample
        } else {
            transition.command.next.next().unwrap_or(0.0)
        };
        if !from_intro && transition.command.next.is_underrun() && a.is_some() {
            return a;
        }
        if a.is_none() {
            if transition.command.next.is_underrun() {
                return Some(0.0);
            }
            self.finish_transition();
            return Some(b);
        }
        if transition.faded % self.channels == 0 {
            let progress = ((transition.faded / self.channels) as f32
                / (transition.command.fade_samples / self.channels).max(1) as f32)
                .min(1.0);
            transition.gain_a = (progress * FRAC_PI_2).cos();
            transition.gain_b = (progress * FRAC_PI_2).sin();
        }
        let mixed = sample * transition.gain_a + b * transition.gain_b;
        transition.faded += 1;
        if transition.faded >= transition.command.fade_samples {
            self.finish_transition();
        }
        Some(soft_ceiling(mixed))
    }
}

#[cfg(test)]
#[path = "tests/transition_source.rs"]
mod tests;
