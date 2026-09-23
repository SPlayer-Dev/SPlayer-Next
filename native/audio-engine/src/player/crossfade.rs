use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{ensure, Result};

use super::preload::PreparedPlayback;
use super::{InnerPlayer, PlayerState};
use crate::metadata::AudioMetadata;

/// 已交给输出回调、等待音频边界完成的备用槽位
pub struct ArmedTransition {
    pub ready: PreparedPlayback,
    pub completed: Arc<AtomicBool>,
    pub token: u64,
}

impl InnerPlayer {
    /// 校验备用槽位并在现有输出流中安排帧级交叉过渡
    pub fn arm_prepared_transition(
        &mut self,
        id: &str,
        source: &str,
        remaining_secs: f64,
    ) -> Result<Option<ArmedTransition>> {
        if self.state != PlayerState::Playing || self.transitioning.load(Ordering::Acquire) {
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
        let next_remaining = ready.metadata.duration_secs - ready.start_position;
        if !next_remaining.is_finite() || next_remaining < 2.0 {
            return Ok(None);
        }
        let fade_secs = 2.4_f64.min(remaining_secs - 0.35).min(next_remaining / 2.0);
        let fade_samples = ((fade_secs * sample_rate as f64).round() as u64) * channels;
        let latest_sample =
            (((remaining_secs - fade_secs - 0.35).max(0.0) * sample_rate as f64) as u64) * channels;
        let earliest_sample =
            latest_sample.saturating_sub(((1.2 * rate as f64) as u64) / channels * channels);
        ready.shared.set_preloading(false);
        self.transitioning.store(true, Ordering::Release);
        let completed = playback.queue_transition(
            Arc::clone(&ready.shared),
            Arc::clone(&self.fft),
            earliest_sample,
            latest_sample,
            fade_samples,
        );
        let completed = match completed {
            Ok(completed) => completed,
            Err(error) => {
                self.transitioning.store(false, Ordering::Release);
                return Err(error);
            }
        };
        Ok(Some(ArmedTransition {
            ready,
            completed,
            token: self.load_token.load(Ordering::Acquire),
        }))
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
        self.start_position_timer();
        Some(transition.ready.metadata.clone())
    }
}
