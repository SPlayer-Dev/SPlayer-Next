use std::{
    ptr::NonNull,
    sync::{Arc, Mutex, mpsc},
    thread::{self, JoinHandle},
};

use anyhow::Result;
use block2::RcBlock;
use objc2::{
    AnyThread, Message,
    rc::{Retained, autoreleasepool},
    runtime::{AnyObject, ProtocolObject},
};
use objc2_app_kit::NSImage;
use objc2_foundation::{NSArray, NSData, NSMutableDictionary, NSNumber, NSSize, NSString};
use objc2_media_player::{
    MPChangePlaybackPositionCommandEvent, MPChangePlaybackRateCommandEvent,
    MPChangeRepeatModeCommandEvent, MPChangeShuffleModeCommandEvent, MPMediaItemArtwork,
    MPMediaItemPropertyAlbumTitle, MPMediaItemPropertyArtist, MPMediaItemPropertyArtwork,
    MPMediaItemPropertyPersistentID, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
    MPNowPlayingInfoCenter, MPNowPlayingInfoPropertyElapsedPlaybackTime,
    MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingPlaybackState, MPRemoteCommand,
    MPRemoteCommandCenter, MPRemoteCommandEvent, MPRemoteCommandHandlerStatus, MPRepeatType,
    MPShuffleType,
};

use super::{MediaThreadsafeFunction, SystemMediaControls};
use crate::model::{
    MediaEvent, MediaEventType, MetadataPayload, PlayModeParam, PlayStateParam, PlaybackStatus,
    TimelineParam,
};

struct MacosContext {
    np_info_ctr: Retained<MPNowPlayingInfoCenter>,
    cmd_ctr: Retained<MPRemoteCommandCenter>,
    info: Mutex<Retained<NSMutableDictionary<NSString, AnyObject>>>,
    event_handler: Arc<Mutex<Option<MediaThreadsafeFunction>>>,
    target_tokens: Mutex<Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>>,
}

impl MacosContext {
    pub fn new() -> Self {
        // SAFETY: 上下文仅在专用 actor 线程中创建，两个系统单例和字典均以 Retained 持有。
        unsafe {
            Self {
                np_info_ctr: MPNowPlayingInfoCenter::defaultCenter(),
                cmd_ctr: MPRemoteCommandCenter::sharedCommandCenter(),
                info: Mutex::new(NSMutableDictionary::new()),
                event_handler: Arc::new(Mutex::new(None)),
                target_tokens: Mutex::new(Vec::new()),
            }
        }
    }

    fn store_token(&self, command: &MPRemoteCommand, token: Retained<AnyObject>) {
        if let Ok(mut tokens) = self.target_tokens.lock() {
            tokens.push((command.retain(), token));
        }
    }

    fn add_handler(&self, command: &MPRemoteCommand, event_type: MediaEventType) {
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                if let Ok(guard) = handler_arc.lock()
                    && let Some(tsfn) = guard.as_ref()
                {
                    tsfn.call(
                        MediaEvent::new(event_type),
                        napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        // SAFETY: command 由系统命令中心持有，回调块会由 addTargetWithHandler 复制并由 token 管理生命周期。
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(command, token);
        }
    }

    fn add_toggle_handler(&self) {
        // SAFETY: 命令中心由上下文强引用，且仅在所属 actor 线程访问。
        let command = unsafe { self.cmd_ctr.togglePlayPauseCommand() };
        let handler_arc = self.event_handler.clone();
        let info_ctr = self.np_info_ctr.clone();

        let block = RcBlock::new(move |_| -> MPRemoteCommandHandlerStatus {
            // SAFETY: info_ctr 由回调捕获并强引用，playbackState 不返回借用对象。
            let current = unsafe { info_ctr.playbackState() };
            let evt = if current == MPNowPlayingPlaybackState::Playing {
                MediaEventType::Pause
            } else {
                MediaEventType::Play
            };
            if let Ok(guard) = handler_arc.lock()
                && let Some(tsfn) = guard.as_ref()
            {
                tsfn.call(
                    MediaEvent::new(evt),
                    napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                );
            }
            MPRemoteCommandHandlerStatus::Success
        });

        // SAFETY: command 保持有效，回调块由系统复制，返回 token 被保存到注销为止。
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_seek_handler(&self) {
        // SAFETY: 命令中心由上下文强引用，且仅在所属 actor 线程访问。
        let command = unsafe { self.cmd_ctr.changePlaybackPositionCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                // SAFETY: MediaPlayer 保证回调参数在调用期间是有效 Objective-C 对象；retain 将其生命周期延长到本作用域。
                let seek_evt = unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangePlaybackPositionCommandEvent>().ok());
                if let Some(e) = seek_evt {
                    // SAFETY: 向下转型成功后，positionTime 是该事件类型的标量属性读取。
                    let ms = unsafe { e.positionTime() } * 1000.0;
                    if let Ok(guard) = handler_arc.lock()
                        && let Some(tsfn) = guard.as_ref()
                    {
                        tsfn.call(
                            MediaEvent::seek(ms),
                            napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        // SAFETY: command 保持有效，回调块由系统复制，返回 token 被保存到注销为止。
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_rate_handler(&self) {
        // SAFETY: 命令中心由上下文强引用，且仅在所属 actor 线程访问。
        let command = unsafe { self.cmd_ctr.changePlaybackRateCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                // SAFETY: MediaPlayer 保证回调参数在调用期间有效；retain 后再进行运行时类型检查。
                let rate_evt = unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangePlaybackRateCommandEvent>().ok());
                if let Some(e) = rate_evt {
                    // SAFETY: 向下转型成功后，playbackRate 是该事件类型的标量属性读取。
                    let rate = unsafe { e.playbackRate() };
                    if let Ok(guard) = handler_arc.lock()
                        && let Some(tsfn) = guard.as_ref()
                    {
                        tsfn.call(
                            MediaEvent::set_rate(f64::from(rate)),
                            napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        // SAFETY: command 和 rates 在调用期间有效，系统复制回调块且 token 被保存到注销为止。
        unsafe {
            command.setEnabled(true);
            let rates = NSArray::from_retained_slice(&[
                NSNumber::new_f64(0.25),
                NSNumber::new_f64(0.5),
                NSNumber::new_f64(0.75),
                NSNumber::new_f64(1.0),
                NSNumber::new_f64(1.25),
                NSNumber::new_f64(1.5),
                NSNumber::new_f64(1.75),
                NSNumber::new_f64(2.0),
            ]);
            command.setSupportedPlaybackRates(&rates);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_shuffle_handler(&self) {
        // SAFETY: 命令中心由上下文强引用，且仅在所属 actor 线程访问。
        let command = unsafe { self.cmd_ctr.changeShuffleModeCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                // SAFETY: MediaPlayer 保证回调参数在调用期间有效；retain 后的运行时转型只用于验证事件类型。
                if unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangeShuffleModeCommandEvent>().ok())
                    .is_some()
                    && let Ok(guard) = handler_arc.lock()
                    && let Some(tsfn) = guard.as_ref()
                {
                    tsfn.call(
                        MediaEvent::new(MediaEventType::ToggleShuffle),
                        napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        // SAFETY: command 保持有效，回调块由系统复制，返回 token 被保存到注销为止。
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_repeat_handler(&self) {
        // SAFETY: 命令中心由上下文强引用，且仅在所属 actor 线程访问。
        let command = unsafe { self.cmd_ctr.changeRepeatModeCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                // SAFETY: MediaPlayer 保证回调参数在调用期间有效；retain 后的运行时转型只用于验证事件类型。
                if unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangeRepeatModeCommandEvent>().ok())
                    .is_some()
                    && let Ok(guard) = handler_arc.lock()
                    && let Some(tsfn) = guard.as_ref()
                {
                    tsfn.call(
                        MediaEvent::new(MediaEventType::ToggleRepeat),
                        napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        // SAFETY: command 保持有效，回调块由系统复制，返回 token 被保存到注销为止。
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn set_commands_enabled(&self, enabled: bool) {
        // SAFETY: 所有命令均来自被 Retained 持有的系统命令中心，并只在 actor 线程访问。
        unsafe {
            self.cmd_ctr.playCommand().setEnabled(enabled);
            self.cmd_ctr.pauseCommand().setEnabled(enabled);
            self.cmd_ctr.togglePlayPauseCommand().setEnabled(enabled);
            self.cmd_ctr.nextTrackCommand().setEnabled(enabled);
            self.cmd_ctr.previousTrackCommand().setEnabled(enabled);
            self.cmd_ctr.stopCommand().setEnabled(enabled);
            self.cmd_ctr
                .changePlaybackPositionCommand()
                .setEnabled(enabled);
            self.cmd_ctr.changePlaybackRateCommand().setEnabled(enabled);
            self.cmd_ctr.changeShuffleModeCommand().setEnabled(enabled);
            self.cmd_ctr.changeRepeatModeCommand().setEnabled(enabled);
        }
    }

    fn setup_listeners(&self) {
        // SAFETY: 命令中心在上下文存活期间有效；add_handler 会强引用命令并保存注销 token。
        unsafe {
            self.add_handler(&self.cmd_ctr.playCommand(), MediaEventType::Play);
            self.add_handler(&self.cmd_ctr.pauseCommand(), MediaEventType::Pause);
            self.add_toggle_handler();
            self.add_handler(
                &self.cmd_ctr.previousTrackCommand(),
                MediaEventType::PrevTrack,
            );
            self.add_handler(&self.cmd_ctr.nextTrackCommand(), MediaEventType::NextTrack);
            self.add_handler(&self.cmd_ctr.stopCommand(), MediaEventType::Stop);
        }
        self.add_seek_handler();
        self.add_rate_handler();
        self.add_shuffle_handler();
        self.add_repeat_handler();
    }
}

impl Drop for MacosContext {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl MacosContext {
    fn enable(&self) -> Result<()> {
        self.set_commands_enabled(true);
        Ok(())
    }

    fn disable(&self) -> Result<()> {
        self.set_commands_enabled(false);
        Ok(())
    }

    fn shutdown(&self) -> Result<()> {
        self.set_commands_enabled(false);
        if let Ok(mut tokens) = self.target_tokens.lock() {
            for (cmd, token) in tokens.drain(..) {
                // SAFETY: token 由对应 cmd 的 addTargetWithHandler 返回，两者共同保存且只注销一次。
                unsafe {
                    cmd.removeTarget(Some(&token));
                }
            }
        }
        // SAFETY: 信息中心由上下文强引用，传入 None 不包含悬垂引用。
        unsafe {
            self.np_info_ctr.setNowPlayingInfo(None);
        }
        Ok(())
    }

    fn register_event_handler(&self, callback: MediaThreadsafeFunction) -> Result<()> {
        {
            let mut guard = self
                .event_handler
                .lock()
                .map_err(|e| anyhow::anyhow!("锁中毒: {e:?}"))?;
            *guard = Some(callback);
        }
        // 重复注册（preload HMR）时先卸掉旧 target，否则每个媒体键事件会成倍派发
        if let Ok(mut tokens) = self.target_tokens.lock() {
            for (cmd, token) in tokens.drain(..) {
                // SAFETY: token 由对应 cmd 返回，drain 保证重复注册时每个 target 只移除一次。
                unsafe {
                    cmd.removeTarget(Some(&token));
                }
            }
        }
        self.setup_listeners();
        Ok(())
    }

    fn update_metadata(&self, payload: MetadataPayload) {
        let Ok(info) = self.info.lock() else { return };
        // SAFETY: 字典、键和值均由 Retained 或静态 MediaPlayer 常量持有，且更新串行发生在 actor 线程。
        unsafe {
            info.setObject_forKey(
                &NSString::from_str(&payload.title),
                ProtocolObject::from_ref(MPMediaItemPropertyTitle),
            );
            info.setObject_forKey(
                &NSString::from_str(&payload.artist),
                ProtocolObject::from_ref(MPMediaItemPropertyArtist),
            );
            info.setObject_forKey(
                &NSString::from_str(&payload.album),
                ProtocolObject::from_ref(MPMediaItemPropertyAlbumTitle),
            );
            info.setObject_forKey(
                &NSNumber::new_f64(0.0),
                ProtocolObject::from_ref(MPNowPlayingInfoPropertyElapsedPlaybackTime),
            );

            let persistent_id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            info.setObject_forKey(
                &NSNumber::new_i64(persistent_id),
                ProtocolObject::from_ref(MPMediaItemPropertyPersistentID),
            );

            if let Some(dur_ms) = payload.duration_ms {
                info.setObject_forKey(
                    &NSNumber::new_f64(dur_ms / 1000.0),
                    ProtocolObject::from_ref(MPMediaItemPropertyPlaybackDuration),
                );
            } else {
                info.removeObjectForKey(MPMediaItemPropertyPlaybackDuration);
            }

            if let Some(data) = payload.cover_data {
                let ns_data = NSData::from_vec(data);
                let img = NSImage::alloc();
                if let Some(img) = NSImage::initWithData(img, &ns_data) {
                    let img_size = img.size();
                    let handler =
                        RcBlock::new(move |_: NSSize| -> NonNull<NSImage> { NonNull::from(&*img) });
                    let artwork = MPMediaItemArtwork::alloc();
                    let artwork = MPMediaItemArtwork::initWithBoundsSize_requestHandler(
                        artwork, img_size, &handler,
                    );
                    info.setObject_forKey(
                        &artwork,
                        ProtocolObject::from_ref(MPMediaItemPropertyArtwork),
                    );
                }
            } else {
                info.removeObjectForKey(MPMediaItemPropertyArtwork);
            }

            self.np_info_ctr.setNowPlayingInfo(Some(&*info));
        }
    }

    fn update_playback_status(&self, payload: PlayStateParam) {
        let state = match payload.status {
            PlaybackStatus::Playing => MPNowPlayingPlaybackState::Playing,
            PlaybackStatus::Paused => MPNowPlayingPlaybackState::Paused,
        };
        // SAFETY: 信息中心由上下文强引用，状态是框架定义的有效枚举值。
        unsafe {
            self.np_info_ctr.setPlaybackState(state);
        }
    }

    fn update_playback_rate(&self, rate: f64) {
        if let Ok(info) = self.info.lock() {
            // SAFETY: 字典及信息中心均有效，NSNumber 在插入时由 Objective-C 容器保留。
            unsafe {
                info.setObject_forKey(
                    &NSNumber::new_f64(rate),
                    ProtocolObject::from_ref(MPNowPlayingInfoPropertyPlaybackRate),
                );
                self.np_info_ctr.setNowPlayingInfo(Some(&*info));
            }
        }
    }

    fn update_timeline(&self, payload: TimelineParam) {
        if let Ok(info) = self.info.lock() {
            // SAFETY: 字典及信息中心均有效，时间值封装为由容器保留的 NSNumber。
            unsafe {
                info.setObject_forKey(
                    &NSNumber::new_f64(payload.current_ms / 1000.0),
                    ProtocolObject::from_ref(MPNowPlayingInfoPropertyElapsedPlaybackTime),
                );
                info.setObject_forKey(
                    &NSNumber::new_f64(payload.total_ms / 1000.0),
                    ProtocolObject::from_ref(MPMediaItemPropertyPlaybackDuration),
                );
                self.np_info_ctr.setNowPlayingInfo(Some(&*info));
            }
        }
    }

    fn update_play_mode(&self, payload: PlayModeParam) {
        // SAFETY: 命令中心由上下文强引用，所有调用串行发生在 actor 线程且枚举值来自框架定义。
        unsafe {
            let shuffle_cmd = self.cmd_ctr.changeShuffleModeCommand();
            shuffle_cmd.setCurrentShuffleType(if payload.shuffle {
                MPShuffleType::Items
            } else {
                MPShuffleType::Off
            });

            let repeat_cmd = self.cmd_ctr.changeRepeatModeCommand();
            repeat_cmd.setCurrentRepeatType(match payload.repeat {
                crate::model::RepeatMode::None => MPRepeatType::Off,
                crate::model::RepeatMode::Track => MPRepeatType::One,
                crate::model::RepeatMode::List => MPRepeatType::All,
            });
        }
    }
}

enum MacosCommand {
    Enable(mpsc::Sender<Result<(), String>>),
    Disable(mpsc::Sender<Result<(), String>>),
    Register(MediaThreadsafeFunction, mpsc::Sender<Result<(), String>>),
    Metadata(MetadataPayload),
    PlaybackStatus(PlayStateParam),
    PlaybackRate(f64),
    Timeline,
    PlayMode(PlayModeParam),
    Shutdown(mpsc::Sender<()>),
}

pub struct MacosImpl {
    sender: Mutex<Option<mpsc::SyncSender<MacosCommand>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    latest_timeline: Arc<Mutex<Option<TimelineParam>>>,
}

impl MacosImpl {
    pub fn new() -> Self {
        Self {
            sender: Mutex::new(None),
            thread: Mutex::new(None),
            latest_timeline: Arc::new(Mutex::new(None)),
        }
    }

    fn start(&self) -> Result<()> {
        let mut sender = self
            .sender
            .lock()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying sender 锁失败: {error}"))?;
        if sender.is_some() {
            return Ok(());
        }
        let (command_tx, command_rx) = mpsc::sync_channel(16);
        let (ready_tx, ready_rx) = mpsc::channel();
        let latest_timeline = Arc::clone(&self.latest_timeline);
        let thread = thread::Builder::new()
            .name("mp-now-playing-actor".to_string())
            .spawn(move || {
                let context = autoreleasepool(|_| MacosContext::new());
                let _ = ready_tx.send(());
                while let Ok(command) = command_rx.recv() {
                    let should_stop = autoreleasepool(|_| match command {
                        MacosCommand::Enable(result) => {
                            let outcome = context.enable();
                            let _ = result.send(outcome.map_err(|error| error.to_string()));
                            false
                        }
                        MacosCommand::Disable(result) => {
                            let outcome = context.disable();
                            let _ = result.send(outcome.map_err(|error| error.to_string()));
                            false
                        }
                        MacosCommand::Register(callback, result) => {
                            let outcome = context.register_event_handler(callback);
                            let _ = result.send(outcome.map_err(|error| error.to_string()));
                            false
                        }
                        MacosCommand::Metadata(payload) => {
                            context.update_metadata(payload);
                            false
                        }
                        MacosCommand::PlaybackStatus(payload) => {
                            context.update_playback_status(payload);
                            false
                        }
                        MacosCommand::PlaybackRate(rate) => {
                            context.update_playback_rate(rate);
                            false
                        }
                        MacosCommand::Timeline => {
                            if let Some(payload) = latest_timeline
                                .lock()
                                .ok()
                                .and_then(|mut timeline| timeline.take())
                            {
                                context.update_timeline(payload);
                            }
                            false
                        }
                        MacosCommand::PlayMode(payload) => {
                            context.update_play_mode(payload);
                            false
                        }
                        MacosCommand::Shutdown(acknowledge) => {
                            let _ = context.shutdown();
                            let _ = acknowledge.send(());
                            true
                        }
                    });
                    if should_stop {
                        break;
                    }
                }
            })?;
        ready_rx
            .recv()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying ready 握手失败: {error}"))?;
        *sender = Some(command_tx);
        *self
            .thread
            .lock()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying thread 锁失败: {error}"))? =
            Some(thread);
        Ok(())
    }

    fn sender(&self) -> Result<mpsc::SyncSender<MacosCommand>> {
        self.sender
            .lock()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying sender 锁失败: {error}"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("MPNowPlaying 尚未初始化"))
    }

    fn request(
        &self,
        build: impl FnOnce(mpsc::Sender<Result<(), String>>) -> MacosCommand,
    ) -> Result<()> {
        let (result_tx, result_rx) = mpsc::channel();
        self.sender()?.send(build(result_tx))?;
        result_rx
            .recv()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying actor 响应失败: {error}"))?
            .map_err(anyhow::Error::msg)
    }

    fn send_update(&self, command: MacosCommand) {
        if let Ok(sender) = self.sender() {
            // 元数据和状态是低频且不可丢的；有界队列满时施加背压，避免系统界面永久停留在旧状态。
            let _ = sender.send(command);
        }
    }

    fn send_timeline(&self) {
        if let Ok(sender) = self.sender() {
            // 时间轴由 latest_timeline 合并，队列繁忙时丢弃通知不会丢失下一次最新位置。
            let _ = sender.try_send(MacosCommand::Timeline);
        }
    }
}

impl SystemMediaControls for MacosImpl {
    fn initialize(&self) -> Result<()> {
        self.start()
    }

    fn enable(&self) -> Result<()> {
        self.request(MacosCommand::Enable)
    }

    fn disable(&self) -> Result<()> {
        self.request(MacosCommand::Disable)
    }

    fn shutdown(&self) -> Result<()> {
        let sender = self
            .sender
            .lock()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying sender 锁失败: {error}"))?
            .take();
        if let Some(sender) = sender {
            let (acknowledge_tx, acknowledge_rx) = mpsc::channel();
            let _ = sender.send(MacosCommand::Shutdown(acknowledge_tx));
            drop(sender);
            let _ = acknowledge_rx.recv();
        }
        if let Some(thread) = self
            .thread
            .lock()
            .map_err(|error| anyhow::anyhow!("MPNowPlaying thread 锁失败: {error}"))?
            .take()
        {
            let _ = thread.join();
        }
        Ok(())
    }

    fn register_event_handler(&self, callback: MediaThreadsafeFunction) -> Result<()> {
        self.request(|result| MacosCommand::Register(callback, result))
    }

    fn update_metadata(&self, payload: MetadataPayload) {
        self.send_update(MacosCommand::Metadata(payload));
    }

    fn update_playback_status(&self, payload: PlayStateParam) {
        self.send_update(MacosCommand::PlaybackStatus(payload));
    }

    fn update_playback_rate(&self, rate: f64) {
        self.send_update(MacosCommand::PlaybackRate(rate));
    }

    fn update_volume(&self, _volume: f64) {}

    fn update_timeline(&self, payload: TimelineParam) {
        if let Ok(mut latest) = self.latest_timeline.lock() {
            *latest = Some(payload);
        }
        self.send_timeline();
    }

    fn update_play_mode(&self, payload: PlayModeParam) {
        self.send_update(MacosCommand::PlayMode(payload));
    }
}
