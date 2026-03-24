mod discord;
mod model;
mod sys_media;

use napi::{
    Result,
    bindgen_prelude::{Function, Unknown},
    threadsafe_function::UnknownReturnValue,
};
use napi_derive::napi;

use model::{
    DiscordConfig, MediaEvent, MetadataParam, MetadataPayload, PlayModeParam, PlayStateParam,
    TimelineParam,
};

/// 初始化系统媒体控件和 Discord RPC 后台线程
#[napi]
pub fn initialize() -> Result<()> {
    discord::init();
    sys_media::get_platform_controls()
        .initialize()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(())
}

/// 关闭并清理资源
#[napi]
pub fn shutdown() {
    discord::disable();
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
pub fn set_metadata(param: MetadataParam) {
    let payload = MetadataPayload::from(param);

    // Discord RPC 只需要 cover_url，不需要占用大量内存的原图数据
    let mut discord_payload = payload.clone();
    discord_payload.cover_data = None;
    discord::update_metadata(discord_payload);

    sys_media::get_platform_controls().update_metadata(payload);
}

/// 更新播放状态
#[napi]
pub fn set_play_state(param: PlayStateParam) {
    discord::update_play_state(param);
    sys_media::get_platform_controls().update_playback_status(param);
}

/// 更新播放速率
#[napi]
pub fn set_rate(rate: f64) {
    sys_media::get_platform_controls().update_playback_rate(rate);
}

/// 更新音量
#[napi]
pub fn set_volume(volume: f64) {
    sys_media::get_platform_controls().update_volume(volume);
}

/// 更新播放进度
#[napi]
pub fn set_timeline(param: TimelineParam) {
    discord::update_timeline(param);
    sys_media::get_platform_controls().update_timeline(param);
}

/// 更新播放模式（随机/循环）
#[napi]
pub fn set_play_mode(param: PlayModeParam) {
    sys_media::get_platform_controls().update_play_mode(param);
}

/// 启用 Discord RPC
#[napi]
pub fn enable_discord() {
    discord::enable();
}

/// 禁用 Discord RPC
#[napi]
pub fn disable_discord() {
    discord::disable();
}

/// 更新 Discord RPC 配置
#[napi]
pub fn set_discord_config(config: DiscordConfig) {
    discord::update_config(config);
}
