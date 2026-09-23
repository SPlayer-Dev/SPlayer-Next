use super::*;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

#[napi]
impl AudioPlayer {
    /// 在当前输出流中交叉切换到已准备的下一曲
    /// @param id - 预载槽位标识
    /// @param source - 预载音源路径
    /// @param remainingSeconds - 当前曲目距离有效结束的墙钟秒数
    /// @param preference - 曲尾安静程度偏好
    /// @returns 成功交接时返回下一曲元信息，槽位失效时返回空值
    #[napi]
    pub async fn transition_to_prepared(
        &self,
        id: String,
        source: String,
        remaining_seconds: f64,
        preference: String,
    ) -> Result<Option<JsMusicMetadata>> {
        let (armed, token_handle) = {
            let mut player = self.inner.lock();
            let armed = player
                .arm_prepared_transition(&id, &source, remaining_seconds, &preference)
                .into_napi()?;
            (armed, player.load_token_handle())
        };
        let Some(armed) = armed else {
            return Ok(None);
        };
        let started = Arc::clone(&armed.started);
        let completed = Arc::clone(&armed.completed);
        let token = armed.token;
        let shared = Arc::clone(&armed.ready.shared);
        let inner = Arc::clone(&self.inner);
        let outcome = tokio::task::spawn_blocking(move || {
            let mut deadline =
                Instant::now() + Duration::from_secs_f64(remaining_seconds.max(0.0) + 10.0);
            let mut announced = false;
            loop {
                if token_handle.load(Ordering::Acquire) != token {
                    return (0_u8, announced);
                }
                if !announced && started.load(Ordering::Acquire) {
                    inner.lock().emit_transition_state(true);
                    announced = true;
                }
                if completed.load(Ordering::Acquire) {
                    return (1_u8, announced);
                }
                if shared.is_decode_failed()
                    || shared.is_all_consumed()
                    || Instant::now() >= deadline
                {
                    return (2_u8, announced);
                }
                if inner.lock().state() == PlayerState::Paused {
                    deadline = Instant::now() + Duration::from_secs(10);
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        })
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?;
        if outcome.1 {
            self.inner.lock().emit_transition_state(false);
        }
        match outcome.0 {
            0 => return Ok(None),
            2 => {
                let mut player = self.inner.lock();
                if player.is_load_token_current(token) {
                    player.stop();
                }
                return Err(Error::from_reason("播放过渡未能完成，已停止失效输出"));
            }
            _ => {}
        }
        let metadata = self.inner.lock().commit_prepared_transition(armed);
        Ok(metadata.map(Self::meta_to_js))
    }
}
