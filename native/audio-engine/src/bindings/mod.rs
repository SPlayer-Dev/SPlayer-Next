use std::sync::Once;

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use tracing::info;

mod player;
mod scanner;
mod tags;

pub use player::*;
pub use scanner::*;
pub use tags::*;

/// anyhow::Error → napi::Error 统一转换。
///
/// 经 `AudioEngineError::classify` 启发式分类，错误消息附带 `[CODE]` 前缀，
/// JS 侧可解析 code 走分支（网络中断 vs 解码失败 vs 取消等）
trait IntoNapiResult<T> {
    fn into_napi(self) -> napi::Result<T>;
}

impl<T> IntoNapiResult<T> for anyhow::Result<T> {
    fn into_napi(self) -> napi::Result<T> {
        self.map_err(|err| {
            let classified = crate::error::AudioEngineError::classify(&err);
            Error::from_reason(format!("[{}] {classified}", classified.code()))
        })
    }
}

/// 初始化原生日志系统。重复调用是无害的（HMR 重载时主进程可能多次注入）
#[napi]
pub fn init_logger(log_dir: String, is_dev: bool) {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        crate::logger::init_logger(&log_dir, is_dev);
        ffmpeg_audio::log::set_log_level(ffmpeg_audio::sys::LogLevel::Fatal);
        info!(log_dir, is_dev, "audio-engine 日志系统已初始化");
    });
}
