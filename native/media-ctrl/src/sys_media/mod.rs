use std::sync::OnceLock;

use anyhow::Result;
use napi::{
    Status,
    threadsafe_function::{ThreadsafeFunction, UnknownReturnValue},
};

use crate::model::{MediaEvent, MetadataPayload, PlayModeParam, PlayStateParam, TimelineParam};

pub type MediaThreadsafeFunction =
    ThreadsafeFunction<MediaEvent, UnknownReturnValue, MediaEvent, Status, false>;

static CONTROLS: OnceLock<Box<dyn SystemMediaControls>> = OnceLock::new();

/// 跨平台媒体控制接口
pub trait SystemMediaControls: Send + Sync {
    fn initialize(&self) -> Result<()>;
    fn enable(&self) -> Result<()>;
    fn disable(&self) -> Result<()>;
    fn shutdown(&self) -> Result<()>;
    fn register_event_handler(&self, callback: MediaThreadsafeFunction) -> Result<()>;
    fn update_metadata(&self, payload: MetadataPayload);
    fn update_playback_status(&self, payload: PlayStateParam);
    fn update_playback_rate(&self, rate: f64);
    fn update_volume(&self, volume: f64);
    fn update_timeline(&self, payload: TimelineParam);
    fn update_play_mode(&self, payload: PlayModeParam);
}

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "macos")]
mod macos;

pub fn get_platform_controls() -> &'static dyn SystemMediaControls {
    CONTROLS
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            {
                Box::new(windows::WindowsImpl::new())
            }

            #[cfg(target_os = "linux")]
            {
                Box::new(linux::LinuxImpl::new())
            }

            #[cfg(target_os = "macos")]
            {
                Box::new(macos::MacosImpl::new())
            }

            #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
            {
                Box::new(NoOpControls)
            }
        })
        .as_ref()
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
struct NoOpControls;

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
impl SystemMediaControls for NoOpControls {
    fn initialize(&self) -> Result<()> {
        Ok(())
    }
    fn enable(&self) -> Result<()> {
        Ok(())
    }
    fn disable(&self) -> Result<()> {
        Ok(())
    }
    fn shutdown(&self) -> Result<()> {
        Ok(())
    }
    fn register_event_handler(&self, _: MediaThreadsafeFunction) -> Result<()> {
        Ok(())
    }
    fn update_metadata(&self, _: MetadataPayload) {}
    fn update_playback_status(&self, _: PlayStateParam) {}
    fn update_playback_rate(&self, _: f64) {}
    fn update_volume(&self, _: f64) {}
    fn update_timeline(&self, _: TimelineParam) {}
    fn update_play_mode(&self, _: PlayModeParam) {}
}
