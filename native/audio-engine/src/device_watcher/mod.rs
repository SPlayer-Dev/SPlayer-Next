use anyhow::Result;

#[cfg(not(target_os = "windows"))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
use unsupported::Backend as SelectedBackend;
#[cfg(target_os = "windows")]
use windows::Backend as SelectedBackend;

pub(super) type DeviceChangedCallback = Box<dyn Fn() + Send + 'static>;

trait PlatformBackend: Sized {
    const SUPPORTED: bool;

    fn new(callback: DeviceChangedCallback) -> Result<Self>;
    fn stop(&mut self);
}

pub struct DeviceWatcher {
    backend: SelectedBackend,
}

impl DeviceWatcher {
    pub fn new(callback: DeviceChangedCallback) -> Result<Self> {
        Ok(Self {
            backend: SelectedBackend::new(callback)?,
        })
    }

    pub fn stop(&mut self) {
        self.backend.stop();
    }
}

impl Drop for DeviceWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn is_supported() -> bool {
    SelectedBackend::SUPPORTED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_platform_backend_support() {
        assert_eq!(is_supported(), cfg!(target_os = "windows"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn watcher_can_be_stopped_more_than_once() {
        let mut watcher = DeviceWatcher::new(Box::new(|| {})).unwrap();
        watcher.stop();
        watcher.stop();
    }
}
