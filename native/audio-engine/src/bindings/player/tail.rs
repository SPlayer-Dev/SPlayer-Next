use super::*;
use std::sync::atomic::Ordering;

#[napi]
impl AudioPlayer {
    /// 后台检查当前本地音源的连续近静音拖尾，不改变实际时长或播放位置
    /// @param startSeconds - 当前曲目或 CUE 分轨的起点
    /// @param endSeconds - 当前曲目或 CUE 分轨的终点
    /// @returns 确认的交接终点，未确认或已切歌时为空
    #[napi]
    pub async fn analyze_tail(&self, start_seconds: f64, end_seconds: f64) -> Result<Option<f64>> {
        let (source, token_handle, token) = {
            let player = self.inner.lock();
            let token_handle = player.load_token_handle();
            let token = token_handle.load(Ordering::Acquire);
            (
                player.current_source().map(String::from),
                token_handle,
                token,
            )
        };
        let Some(source) = source else {
            return Ok(None);
        };
        if source.starts_with("http://") || source.starts_with("https://") {
            return Ok(None);
        }
        tokio::task::spawn_blocking(move || {
            decoder::tail::analyze_tail(&source, start_seconds, end_seconds, || {
                token_handle.load(Ordering::Acquire) != token
            })
            .into_napi()
        })
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
    }
}
