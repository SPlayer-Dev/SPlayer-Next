use std::sync::Arc;

use crate::shared::Shared;

/// 播放器推送给 JS 侧的事件类型
#[derive(Clone, Debug)]
pub enum PlayerEvent {
    /// 状态变化
    StateChanged { state: PlayerState },
    /// 播放结束
    Ended,
    /// 音源失效（网络中断 / URL 过期）
    SourceError,
    /// 位置更新（秒）—— 由内部定时器推送
    Position { position: f64, duration: f64 },
    /// FFT 频谱数据推送
    FftData { ldata: Vec<f32>, rdata: Vec<f32> },
    /// 输出流停滞（输出回调长时间未消费样本，需要外部重建输出）
    OutputStalled,
    /// 输出流在运行期失效（CPAL 流错误），由 JS 侧触发输出重建
    OutputFailed,
    /// WASAPI 独占模式打开失败已回退共享模式，reason 为分类键
    OutputFallback { reason: String },
}

/// 事件发射器类型（跨线程安全）
pub type EventEmitter = Arc<dyn Fn(PlayerEvent) + Send + Sync>;

/// 根据解码结束原因与当前位置决定对外完成事件
pub(super) fn playback_completion_event(
    shared: &Shared,
    duration: f64,
    position: f64,
) -> PlayerEvent {
    let mid_stream = duration <= 0.0 || duration - position > 3.0;
    if shared.is_decode_failed() && mid_stream {
        PlayerEvent::SourceError
    } else {
        PlayerEvent::Ended
    }
}

/// 播放状态
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PlayerState {
    Idle,
    Playing,
    Paused,
    Stopped,
}
