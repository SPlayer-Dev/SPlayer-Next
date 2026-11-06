use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use anyhow::{ensure, Result};

use super::preload::PreparedPlayback;
use super::{InnerPlayer, PlayerState};
use crate::decoder::buffer::Shared;
use crate::decoder::transition_source::{MixEnvelope, TransitionPlan};
use crate::dsp::{equalizer::Equalizer, tempo::StretchProcessor};
use crate::metadata::AudioMetadata;
use parking_lot::Mutex;

/// 在途过渡的第二路 DSP，供用户调整音效时同步两路参数
pub(super) struct TransitionDsp {
    pub initial_speed: f32,
    pub shared: Arc<Shared>,
    pub equalizer: Arc<Mutex<Equalizer>>,
    pub tempo: Arc<Mutex<StretchProcessor>>,
    pub automix: bool,
}

/// 已分析的自动混音参数，源时间使用秒
pub struct AutoMixSettings {
    pub out_start: f64,
    pub in_start: f64,
    pub duration: f64,
    pub rate: f32,
    pub level_ratio: f32,
    pub envelopes: Vec<MixEnvelope>,
}

/// 已交给输出回调、等待音频边界完成的备用槽位
pub struct ArmedTransition {
    pub ready: PreparedPlayback,
    pub started: Arc<AtomicBool>,
    pub completed: Arc<AtomicBool>,
    pub decision: Arc<AtomicU8>,
    pub fade_seconds: f64,
    pub token: u64,
    pub cancelled: Arc<AtomicBool>,
}

impl InnerPlayer {
    /// 绑定当前曲唯一的有限分离窗口，偏移以当前解码起点为基准
    /// @param path - 临时声部文件
    /// @param start - 源时间起点秒数
    /// @param frames - 有效帧数
    /// @param source - 分析时的音源身份
    /// @returns 音源仍匹配时安装窗口
    pub fn install_stems(&self, path: &str, start: f64, frames: u32, source: &str) -> Result<bool> {
        if self.current_source.as_deref() != Some(source) {
            return Ok(false);
        }
        if let Some(shared) = &self.shared {
            shared.set_stems(Some(crate::decoder::stems::StemWindow::load(
                path,
                start - self.seek_base,
                frames,
            )?));
            return Ok(true);
        }
        Ok(false)
    }
    /// 沿用现有绑定参数安排帧级过渡，自动混音作为可选扩展
    /// @param id - 预载槽位标识
    /// @param source - 本地预载音源
    /// @param remaining_secs - 当前曲目剩余墙钟秒数
    /// @param preference - 交叉过渡偏好
    /// @param next_end_seconds - 下一曲 CUE 结束位置
    /// @param current_end_seconds - 当前曲 CUE 结束位置
    /// @param automix - 已分析的自动混音参数
    /// @returns 已提交的过渡资源，状态不适用时为空
    #[allow(clippy::too_many_arguments)]
    pub fn arm_prepared_transition(
        &mut self,
        id: &str,
        source: &str,
        remaining_secs: f64,
        preference: &str,
        next_end_seconds: Option<f64>,
        current_end_seconds: Option<f64>,
        automix: Option<AutoMixSettings>,
    ) -> Result<Option<ArmedTransition>> {
        if self.state != PlayerState::Playing || self.transitioning.load(Ordering::Acquire) {
            return Ok(None);
        }
        if automix.is_some() && ((self.speed() - 1.0).abs() >= 0.0001 || self.pitch() != 0) {
            return Ok(None);
        }
        let Some(output) = &self.output else {
            return Ok(None);
        };
        let sample_rate = u64::from(output.sample_rate());
        let channels = u64::from(output.channels());
        let rate = sample_rate * channels;
        let Some(playback) = self.playback.as_ref().map(Arc::clone) else {
            return Ok(None);
        };
        if !remaining_secs.is_finite() || remaining_secs < 1.0 {
            return Ok(None);
        }
        let Some(ready) = self.take_prepared(Some(id), source) else {
            return Ok(None);
        };
        ensure!(ready.shared.output_ready(), "下一曲尚未准备好音频样本");
        let next_end = next_end_seconds
            .unwrap_or(ready.metadata.duration_secs)
            .min(ready.metadata.duration_secs);
        let next_remaining = next_end - ready.start_position;
        if !next_remaining.is_finite() || next_remaining < 2.0 {
            return Ok(None);
        }
        let current_end = current_end_seconds.unwrap_or(self.duration());
        let remaining_secs =
            remaining_secs.min((current_end - self.position()).max(0.0) / f64::from(self.speed()));
        if remaining_secs < 1.0 {
            return Ok(None);
        }
        if current_end_seconds.is_some() {
            if let Some(shared) = &self.shared {
                shared.set_end_position(current_end - self.seek_base);
            }
        }
        if next_end_seconds.is_some() {
            ready.shared.set_end_position(next_remaining);
        }
        let (fade_limit, quiet_threshold, quiet_windows_required, search_secs) = match preference {
            "conservative" => (3.0_f64, 0.04_f32, 4_u8, 1.0_f64),
            "eager" => (5.0, 0.06, 3, 3.0),
            _ => (3.6, 0.04, 4, 2.0),
        };
        let mut fade_secs = fade_limit
            .min(remaining_secs)
            .min(next_remaining / f64::from(self.speed()) / 2.0);
        let mut auto_start_sample = None;
        let mut auto_rate = 1.0;
        if let Some(plan) = &automix {
            // 区间判断已拒绝 NaN 与无穷，起点只参与可能放过 NaN 的比较，需单独校验
            ensure!(
                plan.out_start.is_finite()
                    && plan.in_start.is_finite()
                    && (0.5..=2.0).contains(&plan.level_ratio)
                    && (0.92..=1.08).contains(&plan.rate)
                    && (1.0..=18.0).contains(&plan.duration),
                "无效的 AutoMix 计划"
            );
            ensure!(
                plan.envelopes.len() == 8
                    && plan
                        .envelopes
                        .iter()
                        .all(|span| span.start >= 0.0 && span.end <= 1.0 && span.end > span.start),
                "无效的混音声部包络"
            );
            if plan.out_start < self.position() + 0.25
                || plan.out_start + plan.duration * f64::from(plan.rate) > current_end + 0.001
                || (plan.in_start - ready.start_position).abs() > 0.001
                || plan.duration + 0.25 > next_remaining
            {
                return Ok(None);
            }
            fade_secs = plan.duration;
            auto_rate = plan.rate;
            auto_start_sample = Some(
                (((plan.out_start - self.seek_base) * sample_rate as f64).round() as u64)
                    * channels,
            );
        }
        let fade_samples = ((fade_secs * sample_rate as f64).round() as u64) * channels;
        let latest_sample =
            (((remaining_secs - fade_secs).max(0.0) * sample_rate as f64) as u64) * channels;
        let earliest_sample = latest_sample
            .saturating_sub(((search_secs * rate as f64) as u64) / channels * channels);
        ready.shared.set_preloading(false);
        self.transitioning.store(true, Ordering::Release);
        let signals = playback.queue_transition(
            Arc::clone(&ready.shared),
            TransitionPlan {
                earliest_sample,
                latest_sample,
                fade_samples,
                quiet_threshold,
                quiet_windows_required,
                auto_start_sample,
                level_ratio: automix.as_ref().map(|plan| plan.level_ratio),
                envelopes: automix
                    .as_ref()
                    .map(|plan| plan.envelopes.as_slice().try_into().unwrap()),
            },
        );
        let signals = match signals {
            Ok(signals) => signals,
            Err(error) => {
                self.transitioning.store(false, Ordering::Release);
                return Err(error);
            }
        };
        self.tempo.lock().set_automix_rate(auto_rate);
        self.transition_dsp = Some(TransitionDsp {
            initial_speed: ready.config.speed,
            shared: Arc::clone(&ready.shared),
            equalizer: Arc::clone(&ready.equalizer),
            tempo: Arc::clone(&ready.tempo),
            automix: automix.is_some(),
        });
        Ok(Some(ArmedTransition {
            ready,
            started: signals.started,
            completed: signals.completed,
            decision: signals.decision,
            fade_seconds: fade_secs,
            token: self.load_token.load(Ordering::Acquire),
            cancelled: signals.cancelled,
        }))
    }

    /// 用户改变速度或音调时撤回自动混音，交叉过渡维持原有行为
    pub(super) fn cancel_automix(&self) {
        self.tempo.lock().set_automix_rate(1.0);
        if let Some(dsp) = &self.transition_dsp {
            dsp.tempo.lock().set_automix_rate(1.0);
            if dsp.automix {
                if let Some(playback) = &self.playback {
                    playback.cancel_transition();
                }
            }
        }
    }

    /// 实时回调撤回混音后恢复当前曲的普通播放状态
    pub fn finish_cancelled_transition(&mut self) {
        self.cancel_automix();
        self.transitioning.store(false, Ordering::Release);
        self.transition_dsp = None;
        if let Some(playback) = &self.playback {
            playback.drain_retired();
        }
    }

    /// 输出回调完成交接后，切换播放器的曲目状态和解码资源
    pub fn commit_prepared_transition(
        &mut self,
        mut transition: ArmedTransition,
    ) -> Option<AudioMetadata> {
        if transition.token != self.load_token.load(Ordering::Acquire)
            || !transition.completed.load(Ordering::Acquire)
        {
            return None;
        }
        self.stop_position_timer();
        if let Some(handle) = self.pending_load_handle.take() {
            handle.cancel();
        }
        if let Some(shared) = self.shared.replace(Arc::clone(&transition.ready.shared)) {
            shared.stop();
        }
        self.decoder_thread = transition.ready.decoder.take();
        self.pending_load_handle = transition.ready.cancel.take();
        self.replace_dsp(
            Arc::clone(&transition.ready.equalizer),
            Arc::clone(&transition.ready.tempo),
        );
        self.seek_base = transition.ready.start_position;
        self.current_source = Some(transition.ready.source.clone());
        self.audio_duration = transition.ready.metadata.duration_secs;
        self.original_sample_rate = transition.ready.metadata.original_sample_rate;
        self.original_bits = transition.ready.metadata.bits_per_sample;
        self.cover_raw = transition.ready.metadata.cover_raw.take();
        self.playback.as_ref()?.drain_retired();
        self.transitioning.store(false, Ordering::Release);
        self.transition_dsp = None;
        self.start_position_timer();
        Some(transition.ready.metadata.clone())
    }
}
