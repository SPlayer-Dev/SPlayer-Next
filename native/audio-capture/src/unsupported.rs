//! 非 Windows / Linux 平台的采集后端：当前暂不支持
//! （macOS 系统采集待实现，麦克风走渲染进程 getUserMedia）

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use super::backend::{BackendError, CaptureBackend, CaptureConfig, CaptureSink};

pub fn platform_supported() -> bool {
    false
}

/// 非 Windows / Linux 平台无 COM，返回空守卫
pub fn init_com() -> Result<NoopComGuard, BackendError> {
    Ok(NoopComGuard)
}

pub struct NoopComGuard;

impl Drop for NoopComGuard {
    fn drop(&mut self) {}
}

pub fn open_backend(
    _config: &CaptureConfig,
    _cancelled: Arc<AtomicBool>,
) -> Result<Arc<dyn CaptureBackend>, BackendError> {
    Err(BackendError::Unsupported)
}
