use std::{
    ptr::NonNull,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use block2::RcBlock;
use objc2::{
    AnyThread, Message,
    rc::Retained,
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

pub struct MacosImpl {
    np_info_ctr: Retained<MPNowPlayingInfoCenter>,
    cmd_ctr: Retained<MPRemoteCommandCenter>,
    info: Mutex<Retained<NSMutableDictionary<NSString, AnyObject>>>,
    event_handler: Arc<Mutex<Option<MediaThreadsafeFunction>>>,
    target_tokens: Mutex<Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>>,
}

#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for MacosImpl {}
unsafe impl Sync for MacosImpl {}

impl MacosImpl {
    pub fn new() -> Self {
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
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(command, token);
        }
    }

    fn add_toggle_handler(&self) {
        let command = unsafe { self.cmd_ctr.togglePlayPauseCommand() };
        let handler_arc = self.event_handler.clone();
        let info_ctr = self.np_info_ctr.clone();

        let block = RcBlock::new(move |_| -> MPRemoteCommandHandlerStatus {
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

        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_seek_handler(&self) {
        let command = unsafe { self.cmd_ctr.changePlaybackPositionCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let seek_evt = unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangePlaybackPositionCommandEvent>().ok());
                if let Some(e) = seek_evt {
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
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_rate_handler(&self) {
        let command = unsafe { self.cmd_ctr.changePlaybackRateCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let rate_evt = unsafe { Retained::retain(event.as_ptr()) }
                    .and_then(|e| e.downcast::<MPChangePlaybackRateCommandEvent>().ok());
                if let Some(e) = rate_evt {
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
        let command = unsafe { self.cmd_ctr.changeShuffleModeCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
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
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn add_repeat_handler(&self) {
        let command = unsafe { self.cmd_ctr.changeRepeatModeCommand() };
        let handler_arc = self.event_handler.clone();
        let block = RcBlock::new(
            move |event: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
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
        unsafe {
            command.setEnabled(true);
            let token = command.addTargetWithHandler(&block);
            self.store_token(&command, token);
        }
    }

    fn set_commands_enabled(&self, enabled: bool) {
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

impl Drop for MacosImpl {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl SystemMediaControls for MacosImpl {
    fn initialize(&self) -> Result<()> {
        Ok(())
    }

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
                unsafe {
                    cmd.removeTarget(Some(&token));
                }
            }
        }
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
        self.setup_listeners();
        Ok(())
    }

    fn update_metadata(&self, payload: MetadataPayload) {
        let Ok(info) = self.info.lock() else { return };
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
                    let handler = RcBlock::new(move |_: NSSize| -> NonNull<NSImage> {
                        NonNull::new(Retained::as_ptr(&img).cast_mut()).expect("NSImage null")
                    });
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
        unsafe {
            self.np_info_ctr.setPlaybackState(state);
        }
    }

    fn update_playback_rate(&self, rate: f64) {
        if let Ok(info) = self.info.lock() {
            unsafe {
                info.setObject_forKey(
                    &NSNumber::new_f64(rate),
                    ProtocolObject::from_ref(MPNowPlayingInfoPropertyPlaybackRate),
                );
                self.np_info_ctr.setNowPlayingInfo(Some(&*info));
            }
        }
    }

    fn update_volume(&self, _volume: f64) {}

    fn update_timeline(&self, payload: TimelineParam) {
        if let Ok(info) = self.info.lock() {
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
