use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use anyhow::{ensure, Result};

use super::preload::PreparedPlayback;
use super::{InnerPlayer, PlayerState};
use crate::decoder::buffer::Shared;
use crate::decoder::transition_source::{TransitionPlan, TRANSITION_CANCELLED};
use crate::dsp::{equalizer::Equalizer, tempo::StretchProcessor};
use crate::metadata::AudioMetadata;
use parking_lot::Mutex;

/// 在途过渡的第二路 DSP，供用户调整音效时同步两路参数
pub(super) struct TransitionDsp {
    pub id: String,
    pub decision: Arc<AtomicU8>,
    pub initial_speed: f32,
    pub shared: Arc<Shared>,
    pub equalizer: Arc<Mutex<Equalizer>>,
    pub tempo: Arc<Mutex<StretchProcessor>>,
}

/// 已交给输出回调、等待音频边界完成的备用槽位
pub struct ArmedTransition {
    pub ready: PreparedPlayback,
    pub started: Arc<AtomicBool>,
    pub completed: Arc<AtomicBool>,
    pub decision: Arc<AtomicU8>,
    pub fade_seconds: f64,
    pub token: u64,
}

impl InnerPlayer {
    /// 校验备用槽位并在当前输出流中接续，指定偏好时才进行交叉淡化
    /// @param id - 预载槽位标识
    /// @param source - 预载音源路径
    /// @param remaining_secs - 交叉淡化使用的剩余墙钟秒数
    /// @param preference - 淡化偏好，省略时保留两曲的全部 PCM
    /// @param next_end_seconds - 下一曲的 CUE 终点
    /// @param current_end_seconds - 当前曲的 CUE 终点
    /// @returns 已交给输出回调的槽位，未命中时返回空值
    pub fn arm_prepared_transition(
        &mut self,
        id: &str,
        source: &str,
        remaining_secs: f64,
        preference: Option<&str>,
        next_end_seconds: Option<f64>,
        current_end_seconds: Option<f64>,
    ) -> Result<Option<ArmedTransition>> {
        if self.state != PlayerState::Playing
            || self.is_finished()
            || self.transitioning.load(Ordering::Acquire)
        {
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
        if preference.is_some() && (!remaining_secs.is_finite() || remaining_secs < 1.0) {
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
        if preference.is_some() && (!next_remaining.is_finite() || next_remaining < 2.0) {
            return Ok(None);
        }
        let current_end = current_end_seconds.unwrap_or(self.duration());
        let remaining_secs =
            remaining_secs.min((current_end - self.position()).max(0.0) / f64::from(self.speed()));
        if preference.is_some() && remaining_secs < 1.0 {
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
        let mut fade_secs = 0.0;
        let plan = preference.map(|preference| {
            let (fade_limit, quiet_threshold, quiet_windows_required, search_secs) =
                match preference {
                    "conservative" => (3.0_f64, 0.04_f32, 4_u8, 1.0_f64),
                    "eager" => (5.0, 0.06, 3, 3.0),
                    _ => (3.6, 0.04, 4, 2.0),
                };
            fade_secs = fade_limit
                .min(remaining_secs)
                .min(next_remaining / f64::from(self.speed()) / 2.0);
            let fade_samples = ((fade_secs * sample_rate as f64).round() as u64) * channels;
            let latest_sample =
                (((remaining_secs - fade_secs).max(0.0) * sample_rate as f64) as u64) * channels;
            let earliest_sample = latest_sample
                .saturating_sub(((search_secs * rate as f64) as u64) / channels * channels);
            ready.shared.set_preloading(false);
            TransitionPlan {
                earliest_sample,
                latest_sample,
                fade_samples,
                quiet_threshold,
                quiet_windows_required,
            }
        });
        self.transitioning.store(true, Ordering::Release);
        let signals = playback.queue_transition(Arc::clone(&ready.shared), plan);
        let signals = match signals {
            Ok(signals) => signals,
            Err(error) => {
                self.transitioning.store(false, Ordering::Release);
                return Err(error);
            }
        };
        self.transition_dsp = Some(TransitionDsp {
            id: ready.id.clone(),
            decision: Arc::clone(&signals.decision),
            initial_speed: ready.config.speed,
            shared: Arc::clone(&ready.shared),
            equalizer: Arc::clone(&ready.equalizer),
            tempo: Arc::clone(&ready.tempo),
        });
        Ok(Some(ArmedTransition {
            ready,
            started: signals.started,
            completed: signals.completed,
            decision: signals.decision,
            fade_seconds: fade_secs,
            token: self.load_token.load(Ordering::Acquire),
        }))
    }

    /// 取消尚未接入的备用 PCM，不停止当前音频流
    /// @param id - 要取消的预载槽位标识
    pub fn cancel_prepared_transition(&mut self, id: &str) {
        if let Some(next) = &self.transition_dsp {
            if next.id == id {
                let _ = next.decision.compare_exchange(
                    0,
                    TRANSITION_CANCELLED,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
            }
        }
    }

    /// 清理已取消交接的控制状态，恢复当前曲的结束通知
    pub fn finish_cancelled_transition(&mut self) {
        self.transition_dsp = None;
        self.transitioning.store(false, Ordering::Release);
        if let Some(playback) = &self.playback {
            playback.drain_retired();
        }
    }

    /// 输出回调完成交接后，切换播放器的曲目状态和解码资源
    /// @param transition - 已经由输出回调接入的预载槽位
    /// @returns 下一曲元数据，已被其他播放操作取代时返回空值
    pub fn commit_prepared_transition(
        &mut self,
        mut transition: ArmedTransition,
    ) -> Option<AudioMetadata> {
        if transition.token != self.load_token.load(Ordering::Acquire)
            || !transition.completed.load(Ordering::Acquire)
        {
            return None;
        }
        transition.ready.shared.set_preloading(false);
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
