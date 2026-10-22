use std::sync::Arc;

use ffmpeg_audio::HttpCancelHandle;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::output::device_watcher;
use crate::output::playback::PlaybackHandle;
use crate::player::{self, InnerPlayer, PlayerEvent, PlayerState, SeekTake};
use crate::{decoder, output};

use super::IntoNapiResult;

/// load 被更新的 load/stop 取代时的标准错误标签与文案
const LOAD_SUPERSEDED_REASON: &str = "[Cancelled] load 已被更新的 load 取代";

/// 判断是否为取消/抢占错误
fn is_cancelled_napi_error(error: &Error) -> bool {
    error.reason.starts_with("[Cancelled]")
}

/// NAPI 错误由 `IntoNapiResult` 以稳定类别前缀编码，恢复路径据此避免把设备失败误报为音源失效
fn is_device_napi_error(error: &Error) -> bool {
    error.reason.starts_with("[Device]")
}

/// PlayerState → JS 字符串
fn state_to_str(state: PlayerState) -> &'static str {
    match state {
        PlayerState::Idle => "idle",
        PlayerState::Playing => "playing",
        PlayerState::Paused => "paused",
        PlayerState::Stopped => "stopped",
    }
}

/// 音频播放器，通过 napi-rs 暴露给 Node.js
#[napi]
pub struct AudioPlayer {
    inner: Arc<Mutex<InnerPlayer>>,
    device_watcher: Mutex<Option<device_watcher::DeviceWatcher>>,
}

mod controls;
mod device;
mod events;
mod load;
mod preload;
mod seek;
mod tail;
mod transition;
mod types;
pub use types::*;

#[napi]
impl AudioPlayer {
    /// 创建新的播放器实例
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().into_napi()?;
        info!("AudioPlayer 实例已创建");
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
            device_watcher: Mutex::new(None),
        })
    }
}
