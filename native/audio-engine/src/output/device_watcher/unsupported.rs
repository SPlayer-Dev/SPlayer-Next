use anyhow::{anyhow, Result};

use super::{DeviceChangedCallback, PlatformBackend};

pub(super) struct Backend;

impl PlatformBackend for Backend {
    const SUPPORTED: bool = false;

    fn new(_callback: DeviceChangedCallback) -> Result<Self> {
        Err(anyhow!("当前平台不支持原生音频设备监听"))
    }

    fn stop(&mut self) {}
}
