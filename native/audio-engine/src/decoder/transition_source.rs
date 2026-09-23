use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use crossbeam_queue::ArrayQueue;

use super::buffer::Shared;
use super::source::DecoderSampleReader;
use crate::dsp::fft::FftAnalyzer;

pub const TRANSITION_DECISION_QUIET: u8 = 1;
const TRANSITION_DECISION_DEADLINE: u8 = 2;
const TRANSITION_DECISION_SOURCE_END: u8 = 3;

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
    quiet_threshold_sq: f32,
    quiet_windows_required: u8,
    started: Arc<AtomicBool>,
    completed: Arc<AtomicBool>,
    decision: Arc<AtomicU8>,
}

pub struct TransitionSignals {
    pub started: Arc<AtomicBool>,
    pub completed: Arc<AtomicBool>,
    pub decision: Arc<AtomicU8>,
}

/// 输出回调使用的有限交接计划
pub struct TransitionPlan {
    pub earliest_sample: u64,
    pub latest_sample: u64,
    pub fade_samples: u64,
    pub quiet_threshold: f32,
    pub quiet_windows_required: u8,
}

struct ActiveTransition {
    command: TransitionCommand,
    elapsed: u64,
    faded: u64,
    timeline_elapsed: f64,
    fade_progress: f64,
    energy_sum: f32,
    energy_samples: u64,
    quiet_windows: u8,
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
    speed_ratio: Arc<AtomicU32>,
    commands: Arc<ArrayQueue<TransitionCommand>>,
    retired: Arc<ArrayQueue<RetiredSource>>,
}

impl TransitionControl {
    /// 调速后按同一比例推进搜索边界和淡化进度，保留当前增益
    pub fn set_speed_ratio(&self, ratio: f32) {
        self.speed_ratio.store(ratio.to_bits(), Ordering::Release);
    }
    /// 将已就绪的下一曲提交到实时输出回调
    /// @param shared - 下一曲的 PCM 缓冲
    /// @param plan - 输出帧、能量阈值及持续窗口构成的交接计划
    /// @returns 回调开始和完成交接时置位的状态
    pub fn queue(&self, shared: Arc<Shared>, plan: TransitionPlan) -> Result<TransitionSignals> {
        let started = Arc::new(AtomicBool::new(false));
        let completed = Arc::new(AtomicBool::new(false));
        let decision = Arc::new(AtomicU8::new(0));
        self.set_speed_ratio(1.0);
        let command = TransitionCommand {
            intro_frame: vec![0.0; shared.channels() as usize],
            next: Box::new(DecoderSampleReader::new(shared)),
            earliest_sample: plan.earliest_sample,
            latest_sample: plan.latest_sample,
            fade_samples: plan.fade_samples.max(1),
            quiet_threshold_sq: plan.quiet_threshold * plan.quiet_threshold,
            quiet_windows_required: plan.quiet_windows_required,
            started: Arc::clone(&started),
            completed: Arc::clone(&completed),
            decision: Arc::clone(&decision),
        };
        self.commands
            .push(command)
            .map_err(|_| anyhow!("已有播放过渡正在等待提交"))?;
        Ok(TransitionSignals {
            started,
            completed,
            decision,
        })
    }

    /// 在控制线程回收已经退出混音的旧音源
    pub fn drain_retired(&self) {
        while self.retired.pop().is_some() {}
    }
}

/// 一条设备输出流中的双槽位混音源
pub struct TransitionSource {
    speed_ratio: f64,
    fft: Arc<FftAnalyzer>,
    fft_enabled: bool,
    fft_buffer: [f32; 256],
    fft_len: usize,
    output_channel: u64,
    output_frame: [f32; 2],
    active: Box<DecoderSampleReader>,
    transition: Option<ActiveTransition>,
    control: TransitionControl,
    channels: u64,
    energy_window_samples: u64,
    max_intro_samples: u64,
}

impl TransitionSource {
    pub fn new(shared: Arc<Shared>, fft: Arc<FftAnalyzer>) -> Self {
        let channels = u64::from(shared.channels());
        let energy_window_samples = (u64::from(shared.sample_rate()) / 20).max(1) * channels;
        let max_intro_samples = u64::from(shared.sample_rate()) * u64::from(shared.channels()) * 2;
        fft.set_sample_rate(shared.sample_rate());
        Self {
            speed_ratio: 1.0,
            fft_enabled: fft.is_enabled(),
            fft,
            fft_buffer: [0.0; 256],
            fft_len: 0,
            output_channel: 0,
            output_frame: [0.0; 2],
            active: Box::new(DecoderSampleReader::new(shared)),
            transition: None,
            control: TransitionControl {
                speed_ratio: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
                commands: Arc::new(ArrayQueue::new(1)),
                retired: Arc::new(ArrayQueue::new(1)),
            },
            channels,
            energy_window_samples,
            max_intro_samples,
        }
    }

    pub fn control(&self) -> TransitionControl {
        self.control.clone()
    }

    pub fn begin_callback(&mut self) {
        self.speed_ratio = f64::from(f32::from_bits(
            self.control.speed_ratio.load(Ordering::Acquire),
        ));
        if self.fft_len > 0 {
            self.fft
                .push_interleaved_samples(&self.fft_buffer[..self.fft_len]);
            self.fft_len = 0;
        }
        self.fft_enabled = self.fft.is_enabled();
        self.active.begin_callback();
        if let Some(transition) = &mut self.transition {
            transition.command.next.begin_callback();
        }
    }

    fn finish_transition(&mut self) {
        let Some(mut transition) = self.transition.take() else {
            return;
        };
        transition.command.next.sync_position();
        let old = std::mem::replace(&mut self.active, transition.command.next);
        let _ = self.control.retired.push(RetiredSource {
            _reader: old,
            _intro_frame: transition.command.intro_frame,
        });
        transition.command.completed.store(true, Ordering::Release);
    }
}

impl TransitionSource {
    fn next_sample(&mut self) -> Option<f32> {
        if self.transition.is_none() {
            if let Some(command) = self.control.commands.pop() {
                self.speed_ratio = f64::from(f32::from_bits(
                    self.control.speed_ratio.load(Ordering::Acquire),
                ));
                let mut next = ActiveTransition {
                    command,
                    elapsed: 0,
                    faded: 0,
                    timeline_elapsed: 0.0,
                    fade_progress: 0.0,
                    energy_sum: 0.0,
                    energy_samples: 0,
                    quiet_windows: 0,
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
        transition.timeline_elapsed += self.speed_ratio;
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
        if transition.timeline_elapsed < transition.command.earliest_sample as f64 {
            return a;
        }

        let sample = a.unwrap_or(0.0);
        if self.active.is_underrun() {
            transition.energy_sum = 0.0;
            transition.energy_samples = 0;
            transition.quiet_windows = 0;
        } else if a.is_some() && transition.faded == 0 {
            transition.energy_sum += sample * sample;
            transition.energy_samples += 1;
            if transition.energy_samples >= self.energy_window_samples {
                if transition.energy_sum
                    < transition.command.quiet_threshold_sq * transition.energy_samples as f32
                {
                    transition.quiet_windows = transition.quiet_windows.saturating_add(1);
                } else {
                    transition.quiet_windows = 0;
                }
                transition.energy_sum = 0.0;
                transition.energy_samples = 0;
            }
        }
        let quiet_found = transition.quiet_windows >= transition.command.quiet_windows_required;
        let start = transition.faded > 0
            || (frame_start
                && (quiet_found
                    || transition.timeline_elapsed >= transition.command.latest_sample as f64
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
        if !from_intro && transition.command.next.is_underrun() {
            return Some(sample * transition.gain_a);
        }
        if a.is_none() && transition.faded == 0 {
            if transition.command.next.is_underrun() {
                return Some(0.0);
            }
            transition
                .command
                .decision
                .store(TRANSITION_DECISION_SOURCE_END, Ordering::Release);
            self.finish_transition();
            return Some(b);
        }
        if transition.faded == 0 {
            let reason = if transition.timeline_elapsed < transition.command.latest_sample as f64
                && quiet_found
            {
                TRANSITION_DECISION_QUIET
            } else {
                TRANSITION_DECISION_DEADLINE
            };
            transition.command.decision.store(reason, Ordering::Release);
            transition.command.started.store(true, Ordering::Release);
        }
        if transition.faded % self.channels == 0 {
            let progress =
                (transition.fade_progress / transition.command.fade_samples as f64).min(1.0) as f32;
            (transition.gain_b, transition.gain_a) = (progress * FRAC_PI_2).sin_cos();
        }
        let mixed = sample * transition.gain_a + b * transition.gain_b;
        transition.faded += 1;
        transition.fade_progress += self.speed_ratio;
        if transition.fade_progress >= transition.command.fade_samples as f64
            && transition.faded % self.channels == 0
        {
            self.finish_transition();
        }
        Some(soft_ceiling(mixed))
    }
}

impl Iterator for TransitionSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.next_sample()?;
        if self.fft_enabled {
            if self.output_channel < 2 {
                self.output_frame[self.output_channel as usize] = sample;
            }
            self.output_channel += 1;
            if self.output_channel == self.channels {
                self.output_channel = 0;
                self.fft_buffer[self.fft_len] = self.output_frame[0];
                self.fft_buffer[self.fft_len + 1] = if self.channels == 1 {
                    self.output_frame[0]
                } else {
                    self.output_frame[1]
                };
                self.fft_len += 2;
                if self.fft_len == self.fft_buffer.len() {
                    self.fft.push_interleaved_samples(&self.fft_buffer);
                    self.fft_len = 0;
                }
            }
        }
        Some(sample)
    }
}

#[cfg(test)]
#[path = "tests/transition_source.rs"]
mod tests;
