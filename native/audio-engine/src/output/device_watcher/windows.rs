use std::sync::mpsc::{self, SyncSender};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use windows::{
    core::{implement, Result as WindowsResult, PCWSTR},
    Win32::{
        Foundation::PROPERTYKEY,
        Media::Audio::{
            eConsole, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
            IMMNotificationClient_Impl, MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    },
};

use super::{DeviceChangedCallback, PlatformBackend};

enum WatchCommand {
    /// true 表示默认输出设备切换，false 表示设备列表变化
    Changed(bool),
    Stop,
}

#[implement(IMMNotificationClient)]
struct DeviceNotificationClient {
    commands: SyncSender<WatchCommand>,
}

impl DeviceNotificationClient {
    fn notify(&self, default_changed: bool) {
        let _ = self
            .commands
            .try_send(WatchCommand::Changed(default_changed));
    }
}

fn is_output_default_change(flow: EDataFlow, role: ERole) -> bool {
    flow == eRender && role == eConsole
}

impl IMMNotificationClient_Impl for DeviceNotificationClient_Impl {
    fn OnDeviceStateChanged(
        &self,
        _device_id: &PCWSTR,
        _new_state: windows::Win32::Media::Audio::DEVICE_STATE,
    ) -> WindowsResult<()> {
        self.notify(false);
        Ok(())
    }

    fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> WindowsResult<()> {
        self.notify(false);
        Ok(())
    }

    fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> WindowsResult<()> {
        self.notify(false);
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _default_device_id: &PCWSTR,
    ) -> WindowsResult<()> {
        if is_output_default_change(flow, role) {
            self.notify(true);
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _device_id: &PCWSTR, _key: &PROPERTYKEY) -> WindowsResult<()> {
        // 音量等设备属性变化也会走此回调，不代表输出设备发生切换
        Ok(())
    }
}

struct ComApartmentGuard;

impl ComApartmentGuard {
    unsafe fn init() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| anyhow!("初始化 COM 失败: {error}"))?;
        Ok(Self)
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub(super) struct Backend {
    commands: SyncSender<WatchCommand>,
    thread: Option<JoinHandle<()>>,
}

impl PlatformBackend for Backend {
    const SUPPORTED: bool = true;

    fn new(callback: DeviceChangedCallback) -> Result<Self> {
        let (command_tx, command_rx) = mpsc::sync_channel(1);
        let notification_tx = command_tx.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);

        let thread = thread::Builder::new()
            .name("audio-device-watcher".into())
            .spawn(move || unsafe {
                let _com_guard = match ComApartmentGuard::init() {
                    Ok(guard) => guard,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };

                let enumerator: IMMDeviceEnumerator =
                    match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                        Ok(enumerator) => enumerator,
                        Err(error) => {
                            let _ = ready_tx.send(Err(format!("创建设备枚举器失败: {error}")));
                            return;
                        }
                    };
                let client: IMMNotificationClient = DeviceNotificationClient {
                    commands: notification_tx,
                }
                .into();

                if let Err(error) = enumerator.RegisterEndpointNotificationCallback(&client) {
                    let _ = ready_tx.send(Err(format!("注册设备通知失败: {error}")));
                    return;
                }
                if ready_tx.send(Ok(())).is_err() {
                    let _ = enumerator.UnregisterEndpointNotificationCallback(&client);
                    return;
                }

                while let Ok(command) = command_rx.recv() {
                    match command {
                        WatchCommand::Changed(default_changed) => callback(default_changed),
                        WatchCommand::Stop => break,
                    }
                }

                let _ = enumerator.UnregisterEndpointNotificationCallback(&client);
            })
            .map_err(|error| anyhow!("启动设备监听线程失败: {error}"))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                commands: command_tx,
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(anyhow!(error))
            }
            Err(error) => {
                let _ = thread.join();
                Err(anyhow!("设备监听线程提前退出: {error}"))
            }
        }
    }

    fn stop(&mut self) {
        if self.thread.is_none() {
            return;
        }
        let _ = self.commands.send(WatchCommand::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
#[path = "tests/windows.rs"]
mod tests;
