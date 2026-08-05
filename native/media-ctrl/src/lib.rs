//! 跨平台系统媒体控件（Windows SMTC / Linux MPRIS / macOS MPNowPlaying）+ Discord RPC。
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

mod discord;
mod logger;
mod model;
mod sys_media;

use napi::{
    Result,
    bindgen_prelude::{Function, Unknown},
    threadsafe_function::UnknownReturnValue,
};
use napi_derive::napi;
use tracing::{error, info};

use model::{
    DiscordConfig, MediaEvent, MetadataParam, MetadataPayload, PlayModeParam, PlayStateParam,
    TimelineParam,
};

/// 初始化原生日志系统（主进程启动时调用一次）
#[napi]
pub fn init_logger(log_dir: String, is_dev: bool) {
    logger::init_logger(&log_dir, is_dev);
    info!(log_dir, is_dev, "media-ctrl 日志系统已初始化");
}

/// 初始化系统媒体控件和 Discord RPC 后台线程
#[napi]
pub fn initialize() -> Result<()> {
    info!("初始化系统媒体控件");
    discord::init().map_err(|error| {
        error!(%error, "Discord RPC 初始化失败");
        napi::Error::from_reason(error.to_string())
    })?;
    if let Err(error) = sys_media::get_platform_controls().initialize() {
        discord::shutdown();
        error!(%error, "系统媒体控件初始化失败");
        return Err(napi::Error::from_reason(error.to_string()));
    }
    Ok(())
}

/// 关闭并清理资源
#[napi]
pub fn shutdown() {
    info!("关闭媒体控件和 Discord RPC");
    discord::shutdown();
    let _ = sys_media::get_platform_controls().shutdown();
}

/// 启用系统媒体控件
#[napi]
pub fn enable() -> Result<()> {
    sys_media::get_platform_controls()
        .enable()
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// 禁用系统媒体控件
#[napi]
pub fn disable() -> Result<()> {
    sys_media::get_platform_controls()
        .disable()
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// 注册媒体事件回调（播放/暂停/上一首/下一首等）
#[napi(ts_args_type = "callback: (event: MediaEvent) => void")]
#[allow(clippy::needless_pass_by_value)]
pub fn on_event(callback: Function<Unknown<'static>, UnknownReturnValue>) -> Result<()> {
    let tsfn = callback
        .build_threadsafe_function::<MediaEvent>()
        .build_callback(|ctx| Ok(ctx.value))?;
    sys_media::get_platform_controls()
        .register_event_handler(tsfn)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// 更新歌曲元数据（同时更新系统媒体控件和 Discord RPC）
#[napi]
pub fn set_metadata(param: MetadataParam) -> Result<()> {
    if param
        .duration_ms
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err(napi::Error::from_reason(
            "durationMs 必须是有限的非负毫秒值",
        ));
    }
    let payload = MetadataPayload::from(param);

    // Discord RPC 只需要 cover_url，不需要占用大量内存的原图数据
    discord::update_metadata(payload.without_cover());

    sys_media::get_platform_controls().update_metadata(payload);
    Ok(())
}

/// 更新播放状态
#[napi]
pub fn set_play_state(param: PlayStateParam) {
    discord::update_play_state(param);
    sys_media::get_platform_controls().update_playback_status(param);
}

/// 更新播放速率
#[napi]
pub fn set_rate(rate: f64) -> Result<()> {
    if !rate.is_finite() || !(0.2..=4.0).contains(&rate) {
        return Err(napi::Error::from_reason("播放速率必须在 0.2 到 4.0 之间"));
    }
    sys_media::get_platform_controls().update_playback_rate(rate);
    Ok(())
}

/// 更新音量
#[napi]
pub fn set_volume(volume: f64) -> Result<()> {
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
        return Err(napi::Error::from_reason("音量必须在 0.0 到 1.0 之间"));
    }
    sys_media::get_platform_controls().update_volume(volume);
    Ok(())
}

/// 更新播放进度
#[napi]
pub fn set_timeline(param: TimelineParam) -> Result<()> {
    if !param.current_ms.is_finite()
        || !param.total_ms.is_finite()
        || param.current_ms < 0.0
        || param.total_ms < 0.0
    {
        return Err(napi::Error::from_reason("时间轴必须使用有限的非负毫秒值"));
    }
    discord::update_timeline(param);
    sys_media::get_platform_controls().update_timeline(param);
    Ok(())
}

/// 更新播放模式（随机/循环）
#[napi]
pub fn set_play_mode(param: PlayModeParam) {
    sys_media::get_platform_controls().update_play_mode(param);
}

/// 启用 Discord RPC
#[napi]
pub fn enable_discord() {
    info!("启用 Discord RPC");
    match discord::init() {
        Ok(()) => discord::enable(),
        Err(error) => error!(%error, "Discord RPC actor 启动失败"),
    }
}

/// 禁用 Discord RPC
#[napi]
pub fn disable_discord() {
    info!("禁用 Discord RPC");
    discord::shutdown();
}

/// 更新 Discord RPC 配置
#[napi]
pub fn set_discord_config(config: DiscordConfig) {
    discord::update_config(config);
}
