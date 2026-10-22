use super::*;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// 只对持续无播放进展的输出计时，倍速变化和暂停不会耗尽交接预算。
struct TransitionWatchdog {
    position: f64,
    incoming_samples: u64,
    last_progress: Instant,
}

impl TransitionWatchdog {
    fn new(position: f64, incoming_samples: u64, now: Instant) -> Self {
        Self {
            position,
            incoming_samples,
            last_progress: now,
        }
    }

    fn stalled(
        &mut self,
        position: f64,
        incoming_samples: u64,
        paused: bool,
        now: Instant,
    ) -> bool {
        if paused || position != self.position || incoming_samples != self.incoming_samples {
            self.last_progress = now;
        }
        self.position = position;
        self.incoming_samples = incoming_samples;
        now.duration_since(self.last_progress) >= Duration::from_secs(10)
    }
}

#[napi]
impl AudioPlayer {
    /// 在当前输出流中交叉切换到已准备的下一曲
    /// @param id - 预载槽位标识
    /// @param source - 预载音源路径
    /// @param remainingSeconds - 当前曲目距离有效结束的墙钟秒数
    /// @param preference - 曲尾交接时机与淡化时长偏好
    /// @param nextEndSeconds - 下一曲的 CUE 结束位置
    /// @param currentEndSeconds - 当前曲目的 CUE 结束位置
    /// @returns 成功交接时返回下一曲元信息，槽位失效时返回空值
    #[napi]
    pub async fn transition_to_prepared(
        &self,
        id: String,
        source: String,
        remaining_seconds: f64,
        preference: String,
        next_end_seconds: Option<f64>,
        current_end_seconds: Option<f64>,
    ) -> Result<Option<JsMusicMetadata>> {
        let inner = Arc::clone(&self.inner);
        let expected_token = inner.lock().load_token_handle().load(Ordering::Acquire);
        // 网络解码器持有阻塞 HTTP 客户端，交接及取消时必须在阻塞线程释放
        tokio::task::spawn_blocking(move || {
            let (armed, token_handle) = {
                let mut player = inner.lock();
                if !player.is_load_token_current(expected_token) {
                    return Ok(None);
                }
                let armed = player
                    .arm_prepared_transition(
                        &id,
                        &source,
                        remaining_seconds,
                        &preference,
                        next_end_seconds,
                        current_end_seconds,
                    )
                    .into_napi()?;
                (armed, player.load_token_handle())
            };
            let Some(armed) = armed else {
                return Ok(None);
            };
            let started = Arc::clone(&armed.started);
            let completed = Arc::clone(&armed.completed);
            let decision = Arc::clone(&armed.decision);
            let fade_seconds = armed.fade_seconds;
            let token = armed.token;
            let shared = Arc::clone(&armed.ready.shared);
            let outcome = {
                let mut watchdog = TransitionWatchdog::new(
                    inner.lock().position(),
                    shared.samples_consumed_count(),
                    Instant::now(),
                );
                let mut announced = false;
                loop {
                    let now = Instant::now();
                    let (position, paused) = {
                        let player = inner.lock();
                        (player.position(), player.state() == PlayerState::Paused)
                    };
                    if token_handle.load(Ordering::Acquire) != token {
                        break (0_u8, announced);
                    }
                    if !announced && started.load(Ordering::Acquire) {
                        let reason = if decision.load(Ordering::Acquire)
                            == crate::decoder::transition_source::TRANSITION_DECISION_QUIET
                        {
                            "quiet"
                        } else {
                            "deadline"
                        };
                        let player = inner.lock();
                        if !player.is_load_token_current(token) {
                            break (0_u8, announced);
                        }
                        player.emit_transition_state(true, Some(reason), Some(fade_seconds));
                        announced = true;
                    }
                    if completed.load(Ordering::Acquire) {
                        break (1_u8, announced);
                    }
                    if shared.is_decode_failed()
                        || shared.is_all_consumed()
                        || watchdog.stalled(position, shared.samples_consumed_count(), paused, now)
                    {
                        break (2_u8, announced);
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            };
            let mut player = inner.lock();
            if !player.is_load_token_current(token) {
                return Ok(None);
            }
            if outcome.1 {
                player.emit_transition_state(false, None, None);
            }
            match outcome.0 {
                0 => return Ok(None),
                2 => {
                    player.stop();
                    return Err(Error::from_reason("播放过渡未能完成，已停止失效输出"));
                }
                _ => {}
            }
            let metadata = player.commit_prepared_transition(armed);
            Ok(metadata.map(Self::meta_to_js))
        })
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slowing_down_keeps_a_progressing_transition_alive() {
        let start = Instant::now();
        let mut watchdog = TransitionWatchdog::new(0.0, 0, start);
        for second in 1..=40 {
            assert!(!watchdog.stalled(
                second as f64 * 0.5,
                0,
                false,
                start + Duration::from_secs(second),
            ));
        }
    }

    #[test]
    fn incoming_progress_keeps_outgoing_eof_alive() {
        let start = Instant::now();
        let mut watchdog = TransitionWatchdog::new(10.0, 0, start);
        for second in 1..=40 {
            assert!(!watchdog.stalled(
                10.0,
                second * 100,
                false,
                start + Duration::from_secs(second),
            ));
        }
    }

    #[test]
    fn paused_time_does_not_consume_the_stall_budget() {
        let start = Instant::now();
        let mut watchdog = TransitionWatchdog::new(1.0, 0, start);
        assert!(!watchdog.stalled(1.0, 0, true, start + Duration::from_secs(60)));
        assert!(!watchdog.stalled(1.0, 0, false, start + Duration::from_secs(69)));
        assert!(watchdog.stalled(1.0, 0, false, start + Duration::from_secs(70)));
    }

    #[test]
    fn a_stalled_output_still_times_out() {
        let start = Instant::now();
        let mut watchdog = TransitionWatchdog::new(1.0, 10, start);
        assert!(!watchdog.stalled(1.0, 10, false, start + Duration::from_secs(9)));
        assert!(watchdog.stalled(1.0, 10, false, start + Duration::from_secs(10)));
    }
}
