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
    Changed,
    Stop,
}

#[implement(IMMNotificationClient)]
struct DeviceNotificationClient {
    commands: SyncSender<WatchCommand>,
}

impl DeviceNotificationClient {
    fn notify(&self) {
        let _ = self.commands.try_send(WatchCommand::Changed);
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
        self.notify();
        Ok(())
    }

    fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> WindowsResult<()> {
        self.notify();
        Ok(())
    }

    fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> WindowsResult<()> {
        self.notify();
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _default_device_id: &PCWSTR,
    ) -> WindowsResult<()> {
        if is_output_default_change(flow, role) {
            self.notify();
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _device_id: &PCWSTR, _key: &PROPERTYKEY) -> WindowsResult<()> {
        self.notify();
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
                        WatchCommand::Changed => callback(),
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
mod tests {
    use super::*;
    use windows::Win32::Media::Audio::{eCapture, eMultimedia, DEVICE_STATE_ACTIVE};

    #[test]
    fn matches_the_default_output_role_used_by_cpal() {
        assert!(is_output_default_change(eRender, eConsole));
        assert!(!is_output_default_change(eCapture, eConsole));
        assert!(!is_output_default_change(eRender, eMultimedia));
    }

    #[test]
    fn emits_notifications_for_device_list_events() {
        let (commands, receiver) = mpsc::sync_channel(1);
        let client: IMMNotificationClient = DeviceNotificationClient { commands }.into();

        unsafe {
            client
                .OnDeviceStateChanged(PCWSTR::null(), DEVICE_STATE_ACTIVE)
                .unwrap();
        }
        assert!(matches!(receiver.try_recv(), Ok(WatchCommand::Changed)));

        unsafe {
            client.OnDeviceAdded(PCWSTR::null()).unwrap();
        }
        assert!(matches!(receiver.try_recv(), Ok(WatchCommand::Changed)));

        unsafe {
            client.OnDeviceRemoved(PCWSTR::null()).unwrap();
        }
        assert!(matches!(receiver.try_recv(), Ok(WatchCommand::Changed)));

        unsafe {
            client
                .OnPropertyValueChanged(PCWSTR::null(), PROPERTYKEY::default())
                .unwrap();
        }
        assert!(matches!(receiver.try_recv(), Ok(WatchCommand::Changed)));
    }

    #[test]
    fn emits_default_changes_only_for_the_console_render_role() {
        let (commands, receiver) = mpsc::sync_channel(1);
        let client: IMMNotificationClient = DeviceNotificationClient { commands }.into();

        unsafe {
            client
                .OnDefaultDeviceChanged(eCapture, eConsole, PCWSTR::null())
                .unwrap();
        }
        assert!(receiver.try_recv().is_err());

        unsafe {
            client
                .OnDefaultDeviceChanged(eRender, eConsole, PCWSTR::null())
                .unwrap();
        }
        assert!(matches!(receiver.try_recv(), Ok(WatchCommand::Changed)));
    }
}
