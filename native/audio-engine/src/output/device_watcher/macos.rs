use std::collections::HashMap;
use std::ffi::c_void;
use std::mem;
use std::ptr::{null, NonNull};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use objc2_core_audio::{
    kAudioDevicePropertyDataSource, kAudioDevicePropertyDataSources,
    kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyJackIsConnected,
    kAudioDevicePropertyNominalSampleRate, kAudioDevicePropertyPreferredChannelLayout,
    kAudioDevicePropertyPreferredChannelsForStereo, kAudioDevicePropertyScopeOutput,
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyStreams, kAudioHardwareNoError,
    kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    AudioDeviceID, AudioObjectAddPropertyListener, AudioObjectGetPropertyData,
    AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress,
    AudioObjectRemovePropertyListener,
};

use super::{DeviceChangedCallback, PlatformBackend};

enum WatchCommand {
    Changed(bool),
    Stop,
}

#[derive(Clone, Copy)]
struct PropertyRegistration {
    object_id: AudioObjectID,
    address: AudioObjectPropertyAddress,
}

static CALLBACKS: OnceLock<Mutex<HashMap<usize, SyncSender<WatchCommand>>>> = OnceLock::new();

fn callbacks() -> &'static Mutex<HashMap<usize, SyncSender<WatchCommand>>> {
    CALLBACKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remove_callback(context_id: usize) {
    if let Ok(mut registered_callbacks) = callbacks().lock() {
        registered_callbacks.remove(&context_id);
    }
}

unsafe extern "C-unwind" fn property_changed(
    _object_id: AudioObjectID,
    address_count: u32,
    addresses: NonNull<AudioObjectPropertyAddress>,
    context: *mut c_void,
) -> i32 {
    let context_id = context as usize;
    let sender = callbacks()
        .lock()
        .ok()
        .and_then(|callbacks| callbacks.get(&context_id).cloned());
    if let Some(sender) = sender {
        let addresses =
            unsafe { std::slice::from_raw_parts(addresses.as_ptr(), address_count as usize) };
        let default_changed = addresses
            .iter()
            .any(|address| address.mSelector == kAudioHardwarePropertyDefaultOutputDevice);
        let _ = sender.try_send(WatchCommand::Changed(default_changed));
    }
    kAudioHardwareNoError
}

fn context_pointer(context_id: usize) -> *mut c_void {
    context_id as *mut c_void
}

fn register_property(
    object_id: AudioObjectID,
    address: AudioObjectPropertyAddress,
    context_id: usize,
) -> Result<PropertyRegistration> {
    let status = unsafe {
        AudioObjectAddPropertyListener(
            object_id,
            NonNull::from(&address),
            Some(property_changed),
            context_pointer(context_id),
        )
    };
    if status != kAudioHardwareNoError {
        return Err(anyhow!("注册 CoreAudio 属性监听失败: {status}"));
    }
    Ok(PropertyRegistration { object_id, address })
}

fn unregister_property(registration: PropertyRegistration, context_id: usize) {
    let status = unsafe {
        AudioObjectRemovePropertyListener(
            registration.object_id,
            NonNull::from(&registration.address),
            Some(property_changed),
            context_pointer(context_id),
        )
    };
    if status != kAudioHardwareNoError {
        tracing::warn!(status, "移除 CoreAudio 属性监听失败");
    }
}

fn audio_device_ids() -> Result<Vec<AudioDeviceID>> {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut data_size = 0;
    let status = unsafe {
        AudioObjectGetPropertyDataSize(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&address),
            0,
            null(),
            NonNull::from(&mut data_size),
        )
    };
    if status != kAudioHardwareNoError {
        return Err(anyhow!("读取 CoreAudio 设备列表大小失败: {status}"));
    }

    let device_count = data_size as usize / mem::size_of::<AudioDeviceID>();
    let mut devices = vec![0; device_count];
    let status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&address),
            0,
            null(),
            NonNull::from(&mut data_size),
            NonNull::new(devices.as_mut_ptr().cast()).expect("设备列表缓冲区不能为空"),
        )
    };
    if status != kAudioHardwareNoError {
        return Err(anyhow!("读取 CoreAudio 设备列表失败: {status}"));
    }
    devices.truncate(data_size as usize / mem::size_of::<AudioDeviceID>());
    Ok(devices)
}

fn supports_output(device_id: AudioDeviceID) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioDevicePropertyStreams,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut data_size = 0;
    let status = unsafe {
        AudioObjectGetPropertyDataSize(
            device_id,
            NonNull::from(&address),
            0,
            null(),
            NonNull::from(&mut data_size),
        )
    };
    status == kAudioHardwareNoError && data_size >= mem::size_of::<AudioObjectID>() as u32
}

fn register_device_properties(context_id: usize) -> Vec<PropertyRegistration> {
    let Ok(devices) = audio_device_ids() else {
        return Vec::new();
    };
    let properties = [
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyDeviceIsAlive,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyDataSource,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyDataSources,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyJackIsConnected,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyPreferredChannelsForStereo,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
        AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyPreferredChannelLayout,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain,
        },
    ];

    devices
        .into_iter()
        .filter(|device_id| supports_output(*device_id))
        .flat_map(|device_id| {
            properties
                .iter()
                .filter_map(move |address| register_property(device_id, *address, context_id).ok())
        })
        .collect()
}

fn refresh_device_properties(registrations: &mut Vec<PropertyRegistration>, context_id: usize) {
    for registration in registrations.drain(..) {
        unregister_property(registration, context_id);
    }
    *registrations = register_device_properties(context_id);
}

pub(super) struct Backend {
    commands: SyncSender<WatchCommand>,
    thread: Option<JoinHandle<()>>,
}

impl PlatformBackend for Backend {
    const SUPPORTED: bool = true;

    fn new(callback: DeviceChangedCallback) -> Result<Self> {
        let (command_tx, command_rx) = mpsc::sync_channel(1);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let context = Box::new(0_u8);
        let context_id = std::ptr::from_ref(context.as_ref()) as usize;
        callbacks()
            .lock()
            .map_err(|_| anyhow!("CoreAudio 回调注册表已损坏"))?
            .insert(context_id, command_tx.clone());

        let thread = thread::Builder::new()
            .name("coreaudio-device-watcher".into())
            .spawn(move || {
                let _context = context;
                let system_properties = [
                    AudioObjectPropertyAddress {
                        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                        mScope: kAudioObjectPropertyScopeGlobal,
                        mElement: kAudioObjectPropertyElementMain,
                    },
                    AudioObjectPropertyAddress {
                        mSelector: kAudioHardwarePropertyDevices,
                        mScope: kAudioObjectPropertyScopeGlobal,
                        mElement: kAudioObjectPropertyElementMain,
                    },
                ];
                let mut system_registrations = Vec::with_capacity(system_properties.len());
                for address in system_properties {
                    match register_property(
                        kAudioObjectSystemObject as AudioObjectID,
                        address,
                        context_id,
                    ) {
                        Ok(registration) => system_registrations.push(registration),
                        Err(error) => {
                            for registration in system_registrations.drain(..) {
                                unregister_property(registration, context_id);
                            }
                            remove_callback(context_id);
                            let _ = ready_tx.send(Err(error.to_string()));
                            return;
                        }
                    }
                }
                let mut device_registrations = register_device_properties(context_id);
                if ready_tx.send(Ok(())).is_err() {
                    for registration in device_registrations.drain(..) {
                        unregister_property(registration, context_id);
                    }
                    for registration in system_registrations.drain(..) {
                        unregister_property(registration, context_id);
                    }
                    remove_callback(context_id);
                    return;
                }

                while let Ok(command) = command_rx.recv() {
                    match command {
                        WatchCommand::Changed(default_changed) => {
                            refresh_device_properties(&mut device_registrations, context_id);
                            callback(default_changed);
                        }
                        WatchCommand::Stop => break,
                    }
                }

                for registration in device_registrations.drain(..) {
                    unregister_property(registration, context_id);
                }
                for registration in system_registrations.drain(..) {
                    unregister_property(registration, context_id);
                }
                remove_callback(context_id);
            })
            .map_err(|error| {
                remove_callback(context_id);
                anyhow!("启动 CoreAudio 设备监听线程失败: {error}")
            })?;

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
                Err(anyhow!("CoreAudio 设备监听线程提前退出: {error}"))
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
