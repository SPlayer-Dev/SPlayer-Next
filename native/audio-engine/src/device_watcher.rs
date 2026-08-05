use std::sync::Arc;

use crate::player::EventEmitter;

/// 原生音频 endpoint 事件。
pub struct DeviceEvent {
    pub kind: &'static str,
    pub device_id: Option<String>,
}

/// 设备 watcher 的跨平台持有者。
pub struct DeviceWatcher {
    #[cfg(target_os = "windows")]
    _inner: windows_watcher::WindowsDeviceWatcher,
    #[cfg(target_os = "macos")]
    _inner: macos_watcher::MacosDeviceWatcher,
    #[cfg(target_os = "linux")]
    _inner: linux_watcher::LinuxDeviceWatcher,
}

impl DeviceWatcher {
    pub fn new(callback: Arc<parking_lot::RwLock<Option<EventEmitter>>>) -> anyhow::Result<Self> {
        #[cfg(target_os = "windows")]
        {
            Ok(Self {
                _inner: windows_watcher::WindowsDeviceWatcher::new(callback)?,
            })
        }

        #[cfg(target_os = "macos")]
        {
            Ok(Self {
                _inner: macos_watcher::MacosDeviceWatcher::new(callback)?,
            })
        }

        #[cfg(target_os = "linux")]
        {
            Ok(Self {
                _inner: linux_watcher::LinuxDeviceWatcher::new(callback)?,
            })
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = callback;
            Ok(Self {})
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_watcher {
    use std::sync::Arc;
    use std::sync::mpsc::{self, SyncSender};
    use std::thread::{self, JoinHandle};

    use anyhow::{Context, Result};
    use parking_lot::RwLock;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
        IMMNotificationClient_Impl, MMDeviceEnumerator, eConsole, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    };
    use windows::core::{PCWSTR, implement};

    use super::DeviceEvent;
    use crate::player::{EventEmitter, PlayerEvent};

    enum WatcherMessage {
        Event(DeviceEvent),
        Shutdown(mpsc::Sender<()>),
    }

    #[implement(IMMNotificationClient)]
    struct NotificationClient {
        sender: SyncSender<WatcherMessage>,
    }

    impl NotificationClient {
        fn send(&self, kind: &'static str, id: &PCWSTR) {
            // SAFETY: MMDevice 保证回调参数指针在本次调用期间有效；立即复制为 Rust String。
            let device_id = unsafe { id.to_string().ok() }.map(|id| format!("wasapi:{id}"));
            let _ = self
                .sender
                .try_send(WatcherMessage::Event(DeviceEvent { kind, device_id }));
        }
    }

    impl IMMNotificationClient_Impl for NotificationClient_Impl {
        fn OnDefaultDeviceChanged(
            &self,
            flow: EDataFlow,
            role: ERole,
            default_device_id: &PCWSTR,
        ) -> windows::core::Result<()> {
            if flow == eRender && role == eConsole {
                self.send("defaultChanged", default_device_id);
            }
            Ok(())
        }

        fn OnDeviceAdded(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
            self.send("added", device_id);
            Ok(())
        }

        fn OnDeviceRemoved(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
            self.send("removed", device_id);
            Ok(())
        }

        fn OnDeviceStateChanged(
            &self,
            device_id: &PCWSTR,
            _new_state: DEVICE_STATE,
        ) -> windows::core::Result<()> {
            self.send("stateChanged", device_id);
            Ok(())
        }

        fn OnPropertyValueChanged(
            &self,
            device_id: &PCWSTR,
            _key: &PROPERTYKEY,
        ) -> windows::core::Result<()> {
            self.send("propertyChanged", device_id);
            Ok(())
        }
    }

    struct ComApartment;

    impl ComApartment {
        fn enter() -> Result<Self> {
            // SAFETY: watcher owner 是新建专用线程，尚未初始化 COM；Drop 在同一线程配对释放。
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .context("初始化设备 watcher COM MTA 失败")?;
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: 与本线程成功的 CoInitializeEx 严格配对。
            unsafe { CoUninitialize() };
        }
    }

    pub struct WindowsDeviceWatcher {
        sender: SyncSender<WatcherMessage>,
        thread: Option<JoinHandle<()>>,
    }

    impl WindowsDeviceWatcher {
        pub fn new(callback: Arc<RwLock<Option<EventEmitter>>>) -> Result<Self> {
            let (message_tx, message_rx) = mpsc::sync_channel(32);
            let (ready_tx, ready_rx) = mpsc::channel();
            let sender = message_tx.clone();
            let thread = thread::Builder::new()
                .name("audio-device-watcher".to_string())
                .spawn(move || {
                    let outcome = (|| -> Result<()> {
                        let _com = ComApartment::enter()?;
                        // SAFETY: COM 已在本线程初始化；返回接口只在本 owner 线程注册和注销。
                        let enumerator: IMMDeviceEnumerator =
                            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                                .context("创建设备枚举器失败")?;
                        let client: IMMNotificationClient =
                            NotificationClient { sender: message_tx }.into();
                        // SAFETY: client 在注销完成前由本作用域强引用，enumerator 只在本线程访问。
                        unsafe { enumerator.RegisterEndpointNotificationCallback(&client) }
                            .context("注册 endpoint 通知失败")?;
                        let _ = ready_tx.send(Ok(()));

                        while let Ok(message) = message_rx.recv() {
                            match message {
                                WatcherMessage::Event(event) => {
                                    emit(&callback, event);
                                }
                                WatcherMessage::Shutdown(acknowledge) => {
                                    // SAFETY: callback 在本线程注册，且 client 仍然存活。
                                    let _ = unsafe {
                                        enumerator.UnregisterEndpointNotificationCallback(&client)
                                    };
                                    let _ = acknowledge.send(());
                                    return Ok(());
                                }
                            }
                        }
                        // SAFETY: channel 异常关闭时仍需在 client drop 前注销。
                        let _ =
                            unsafe { enumerator.UnregisterEndpointNotificationCallback(&client) };
                        Ok(())
                    })();
                    if let Err(error) = &outcome {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                })
                .context("启动音频设备 watcher 线程失败")?;

            match ready_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    sender,
                    thread: Some(thread),
                }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!(error))
                }
                Err(error) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!("设备 watcher ready 握手失败: {error}"))
                }
            }
        }
    }

    fn emit(callback: &RwLock<Option<EventEmitter>>, event: DeviceEvent) {
        if let Some(emitter) = callback.read().as_ref().cloned() {
            emitter(PlayerEvent::DeviceChanged {
                kind: event.kind,
                device_id: event.device_id,
            });
        }
    }

    impl Drop for WindowsDeviceWatcher {
        fn drop(&mut self) {
            let (acknowledge_tx, acknowledge_rx) = mpsc::channel();
            let _ = self.sender.send(WatcherMessage::Shutdown(acknowledge_tx));
            let _ = acknowledge_rx.recv();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_watcher {
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::Arc;
    use std::sync::mpsc::{self, SyncSender};
    use std::thread::{self, JoinHandle};

    use anyhow::{Context, Result, ensure};
    use objc2_core_audio::{
        AudioObjectAddPropertyListener, AudioObjectID, AudioObjectPropertyAddress,
        AudioObjectRemovePropertyListener, kAudioHardwarePropertyDefaultOutputDevice,
        kAudioHardwarePropertyDevices, kAudioObjectPropertyElementMain,
        kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    };
    use parking_lot::RwLock;

    use super::DeviceEvent;
    use crate::player::{EventEmitter, PlayerEvent};

    type OsStatus = i32;

    enum WatcherMessage {
        Event(DeviceEvent),
        Shutdown(mpsc::Sender<()>),
    }

    struct CallbackContext {
        sender: SyncSender<WatcherMessage>,
        kind: &'static str,
    }

    struct PropertyListener {
        context: Box<CallbackContext>,
        address: AudioObjectPropertyAddress,
        removed: bool,
    }

    impl PropertyListener {
        fn new(
            sender: SyncSender<WatcherMessage>,
            selector: u32,
            kind: &'static str,
        ) -> Result<Self> {
            let address = AudioObjectPropertyAddress {
                mSelector: selector,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain,
            };
            let context = Box::new(CallbackContext { sender, kind });
            // SAFETY: context 的 Box 地址在 listener 移除前保持稳定，回调仅发送有界消息。
            let status = unsafe {
                AudioObjectAddPropertyListener(
                    kAudioObjectSystemObject as AudioObjectID,
                    NonNull::from(&address),
                    Some(property_listener_callback),
                    &*context as *const CallbackContext as *mut c_void,
                )
            };
            ensure!(
                status == 0,
                "注册 CoreAudio property listener 失败: {status}"
            );
            Ok(Self {
                context,
                address,
                removed: false,
            })
        }

        fn remove(&mut self) {
            if self.removed {
                return;
            }
            // SAFETY: 使用与注册时相同的 object/address/callback/context，且 context 尚未释放。
            let _ = unsafe {
                AudioObjectRemovePropertyListener(
                    kAudioObjectSystemObject as AudioObjectID,
                    NonNull::from(&self.address),
                    Some(property_listener_callback),
                    &*self.context as *const CallbackContext as *mut c_void,
                )
            };
            self.removed = true;
        }
    }

    impl Drop for PropertyListener {
        fn drop(&mut self) {
            self.remove();
        }
    }

    unsafe extern "C-unwind" fn property_listener_callback(
        _object_id: AudioObjectID,
        _address_count: u32,
        _addresses: NonNull<AudioObjectPropertyAddress>,
        context: *mut c_void,
    ) -> OsStatus {
        // SAFETY: context 由 PropertyListener 持有，只有完成 listener 移除后才会释放。
        let context = unsafe { &*(context as *const CallbackContext) };
        let _ = context.sender.try_send(WatcherMessage::Event(DeviceEvent {
            kind: context.kind,
            device_id: None,
        }));
        0
    }

    pub struct MacosDeviceWatcher {
        sender: SyncSender<WatcherMessage>,
        thread: Option<JoinHandle<()>>,
    }

    impl MacosDeviceWatcher {
        pub fn new(callback: Arc<RwLock<Option<EventEmitter>>>) -> Result<Self> {
            let (message_tx, message_rx) = mpsc::sync_channel(32);
            let sender = message_tx.clone();
            let (ready_tx, ready_rx) = mpsc::channel();
            let thread = thread::Builder::new()
                .name("audio-device-watcher".to_string())
                .spawn(move || {
                    let outcome = (|| -> Result<()> {
                        let mut default_listener = PropertyListener::new(
                            message_tx.clone(),
                            kAudioHardwarePropertyDefaultOutputDevice,
                            "defaultChanged",
                        )?;
                        let mut devices_listener = PropertyListener::new(
                            message_tx,
                            kAudioHardwarePropertyDevices,
                            "devicesChanged",
                        )?;
                        let _ = ready_tx.send(Ok(()));

                        while let Ok(message) = message_rx.recv() {
                            match message {
                                WatcherMessage::Event(event) => emit(&callback, event),
                                WatcherMessage::Shutdown(acknowledge) => {
                                    devices_listener.remove();
                                    default_listener.remove();
                                    let _ = acknowledge.send(());
                                    return Ok(());
                                }
                            }
                        }
                        Ok(())
                    })();
                    if let Err(error) = &outcome {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                })
                .context("启动 CoreAudio 设备 watcher 线程失败")?;

            match ready_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    sender,
                    thread: Some(thread),
                }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!(error))
                }
                Err(error) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!("CoreAudio watcher ready 握手失败: {error}"))
                }
            }
        }
    }

    fn emit(callback: &RwLock<Option<EventEmitter>>, event: DeviceEvent) {
        if let Some(emitter) = callback.read().as_ref().cloned() {
            emitter(PlayerEvent::DeviceChanged {
                kind: event.kind,
                device_id: event.device_id,
            });
        }
    }

    impl Drop for MacosDeviceWatcher {
        fn drop(&mut self) {
            let (acknowledge_tx, acknowledge_rx) = mpsc::channel();
            let _ = self.sender.send(WatcherMessage::Shutdown(acknowledge_tx));
            let _ = acknowledge_rx.recv();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_watcher {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::rc::Rc;
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    use anyhow::{Context, Result};
    use cpal::traits::HostTrait;
    use parking_lot::RwLock;
    use pipewire as pw;
    use pw::metadata::Metadata;
    use pw::proxy::{Listener, ProxyT};
    use pw::types::ObjectType;

    use crate::audio_output::list_output_devices;
    use crate::player::{EventEmitter, PlayerEvent};

    const FALLBACK_PROBE_INTERVAL: Duration = Duration::from_secs(5);
    const METADATA_NAME: &str = "metadata.name";
    const DEFAULT_METADATA: &str = "default";
    const DEFAULT_SINK_KEY: &str = "default.audio.sink";
    const AUDIO_SINK: &str = "Audio/Sink";
    const AUDIO_DUPLEX: &str = "Audio/Duplex";

    pub enum LinuxDeviceWatcher {
        PipeWire(PipeWireDeviceWatcher),
        Fallback(FallbackDeviceWatcher),
    }

    impl LinuxDeviceWatcher {
        pub fn new(callback: Arc<RwLock<Option<EventEmitter>>>) -> Result<Self> {
            if cpal::default_host().id() == cpal::HostId::PipeWire {
                Ok(Self::PipeWire(PipeWireDeviceWatcher::new(callback)?))
            } else {
                Ok(Self::Fallback(FallbackDeviceWatcher::new(callback)?))
            }
        }
    }

    enum LoopMessage {
        Shutdown(mpsc::Sender<()>),
    }

    pub struct PipeWireDeviceWatcher {
        sender: pw::channel::Sender<LoopMessage>,
        thread: Option<JoinHandle<()>>,
    }

    impl PipeWireDeviceWatcher {
        fn new(callback: Arc<RwLock<Option<EventEmitter>>>) -> Result<Self> {
            let (loop_tx, loop_rx) = pw::channel::channel();
            let sender = loop_tx.clone();
            let (ready_tx, ready_rx) = mpsc::channel();
            let thread = thread::Builder::new()
                .name("audio-device-watcher".to_string())
                .spawn(move || {
                    let outcome = run_pipewire_watcher(callback, loop_rx, ready_tx.clone());
                    if let Err(error) = &outcome {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                })
                .context("启动 PipeWire 设备 watcher 线程失败")?;

            match ready_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    sender,
                    thread: Some(thread),
                }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!(error))
                }
                Err(error) => {
                    let _ = thread.join();
                    Err(anyhow::anyhow!("PipeWire watcher ready 握手失败: {error}"))
                }
            }
        }
    }

    fn run_pipewire_watcher(
        callback: Arc<RwLock<Option<EventEmitter>>>,
        loop_rx: pw::channel::Receiver<LoopMessage>,
        ready_tx: mpsc::Sender<Result<(), String>>,
    ) -> Result<()> {
        let mainloop = pw::main_loop::MainLoopRc::new(None)?;
        let context = pw::context::ContextRc::new(&mainloop, None)?;
        let core = context.connect_rc(None)?;
        let registry = core.get_registry_rc()?;
        let initialized = Rc::new(Cell::new(false));
        let output_nodes = Rc::new(RefCell::new(HashMap::<u32, String>::new()));
        let metadata_objects = Rc::new(RefCell::new(
            Vec::<(Box<dyn ProxyT>, Box<dyn Listener>)>::new(),
        ));

        let pending = core.sync(0)?;
        let loop_for_done = mainloop.clone();
        let initialized_for_done = Rc::clone(&initialized);
        let ready_for_done = ready_tx.clone();
        let _core_listener = core
            .add_listener_local()
            .done(move |id, sequence| {
                if id == pw::core::PW_ID_CORE && sequence == pending {
                    initialized_for_done.set(true);
                    let _ = ready_for_done.send(Ok(()));
                }
            })
            .error(move |id, _sequence, result, message| {
                if id == pw::core::PW_ID_CORE && result < 0 {
                    let _ = ready_tx.send(Err(format!("PipeWire core error: {message}")));
                    loop_for_done.quit();
                }
            })
            .register();

        let registry_for_global = registry.clone();
        let initialized_for_global = Rc::clone(&initialized);
        let nodes_for_global = Rc::clone(&output_nodes);
        let metadata_for_global = Rc::clone(&metadata_objects);
        let callback_for_global = Arc::clone(&callback);
        let initialized_for_remove = Rc::clone(&initialized);
        let nodes_for_remove = Rc::clone(&output_nodes);
        let callback_for_remove = Arc::clone(&callback);
        let _registry_listener = registry
            .add_listener_local()
            .global(move |global| match global.type_ {
                ObjectType::Node => {
                    let Some(properties) = global.props else {
                        return;
                    };
                    let Some(media_class) = properties.get(*pw::keys::MEDIA_CLASS) else {
                        return;
                    };
                    if !matches!(media_class, AUDIO_SINK | AUDIO_DUPLEX) {
                        return;
                    }
                    let Some(node_name) = properties.get(*pw::keys::NODE_NAME) else {
                        return;
                    };
                    let device_id = format!("pipewire:{node_name}");
                    nodes_for_global
                        .borrow_mut()
                        .insert(global.id, device_id.clone());
                    if initialized_for_global.get() {
                        emit(&callback_for_global, "added", Some(device_id));
                    }
                }
                ObjectType::Metadata => {
                    if !global.props.is_some_and(|properties| {
                        properties.get(METADATA_NAME) == Some(DEFAULT_METADATA)
                    }) {
                        return;
                    }
                    let Ok(metadata) = registry_for_global.bind::<Metadata, _>(global) else {
                        return;
                    };
                    let callback_for_metadata = Arc::clone(&callback_for_global);
                    let initialized_for_metadata = Rc::clone(&initialized_for_global);
                    let listener = metadata
                        .add_listener_local()
                        .property(move |_subject, key, _type_name, _value| {
                            if initialized_for_metadata.get() && key == Some(DEFAULT_SINK_KEY) {
                                // metadata value 是 JSON 路由描述，不是 CPAL DeviceId；由上层重新枚举默认项。
                                emit(&callback_for_metadata, "defaultChanged", None);
                            }
                            0
                        })
                        .register();
                    metadata_for_global
                        .borrow_mut()
                        .push((Box::new(metadata), Box::new(listener)));
                }
                _ => {}
            })
            .global_remove(move |id| {
                let removed = nodes_for_remove.borrow_mut().remove(&id);
                if initialized_for_remove.get() {
                    if let Some(device_id) = removed {
                        emit(&callback_for_remove, "removed", Some(device_id));
                    }
                }
            })
            .register();

        let loop_for_shutdown = mainloop.clone();
        let _shutdown_receiver = loop_rx.attach(mainloop.loop_(), move |message| match message {
            LoopMessage::Shutdown(acknowledge) => {
                let _ = acknowledge.send(());
                loop_for_shutdown.quit();
            }
        });
        mainloop.run();
        Ok(())
    }

    fn emit(
        callback: &RwLock<Option<EventEmitter>>,
        kind: &'static str,
        device_id: Option<String>,
    ) {
        if let Some(emitter) = callback.read().as_ref().cloned() {
            emitter(PlayerEvent::DeviceChanged { kind, device_id });
        }
    }

    impl Drop for PipeWireDeviceWatcher {
        fn drop(&mut self) {
            let (acknowledge_tx, acknowledge_rx) = mpsc::channel();
            let _ = self.sender.send(LoopMessage::Shutdown(acknowledge_tx));
            let _ = acknowledge_rx.recv();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    pub struct FallbackDeviceWatcher {
        sender: mpsc::Sender<()>,
        thread: Option<JoinHandle<()>>,
    }

    impl FallbackDeviceWatcher {
        fn new(callback: Arc<RwLock<Option<EventEmitter>>>) -> Result<Self> {
            let (shutdown_tx, shutdown_rx) = mpsc::channel();
            let thread = thread::Builder::new()
                .name("audio-device-fallback-probe".to_string())
                .spawn(move || {
                    let mut previous = device_revision();
                    loop {
                        match shutdown_rx.recv_timeout(FALLBACK_PROBE_INTERVAL) {
                            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                let current = device_revision();
                                if current != previous {
                                    let kind = if current.1 != previous.1 {
                                        "defaultChanged"
                                    } else {
                                        "devicesChanged"
                                    };
                                    previous = current;
                                    emit(&callback, kind, None);
                                }
                            }
                        }
                    }
                })
                .context("启动无通知 backend 的设备兜底探测失败")?;
            Ok(Self {
                sender: shutdown_tx,
                thread: Some(thread),
            })
        }
    }

    fn device_revision() -> (Vec<String>, Option<String>) {
        let devices = list_output_devices();
        let default_device_id = devices
            .iter()
            .find_map(|(id, _name, _host, is_default)| is_default.then(|| id.clone()));
        let mut device_ids = devices
            .into_iter()
            .map(|(id, _name, _host, _is_default)| id)
            .collect::<Vec<_>>();
        device_ids.sort_unstable();
        (device_ids, default_device_id)
    }

    impl Drop for FallbackDeviceWatcher {
        fn drop(&mut self) {
            let _ = self.sender.send(());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}
