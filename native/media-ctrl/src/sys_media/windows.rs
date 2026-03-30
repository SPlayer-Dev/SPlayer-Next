use std::sync::{Arc, LazyLock, Mutex};

use anyhow::Result;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use tokio::runtime::Runtime;
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Media::{
        MediaPlaybackAutoRepeatMode, MediaPlaybackStatus, MediaPlaybackType, Playback::MediaPlayer,
        PlaybackPositionChangeRequestedEventArgs, PlaybackRateChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
    core::{HSTRING, Ref},
};

use super::{MediaThreadsafeFunction, SystemMediaControls};
use crate::model::{
    MediaEvent, MediaEventType, MetadataPayload, PlayModeParam, PlayStateParam,
    PlaybackStatus as AppPlaybackStatus, RepeatMode, TimelineParam,
};

const HNS_PER_MS: f64 = 10_000.0;

static TOKIO_RT: LazyLock<Runtime> =
    LazyLock::new(|| Runtime::new().expect("创建 Tokio 运行时失败"));

struct SmtcTokens {
    button_pressed: i64,
    shuffle_changed: i64,
    repeat_changed: i64,
    seek_requested: i64,
    rate_changed: i64,
}

struct SmtcContext {
    player: MediaPlayer,
    tokens: SmtcTokens,
    callback: Option<Arc<MediaThreadsafeFunction>>,
    /// 封面更新代数，每次 update_metadata 递增，旧任务发现代数过期后自行放弃
    cover_generation: u64,
    is_enabled: bool,
}

impl SmtcContext {
    fn smtc(&self) -> Result<SystemMediaTransportControls> {
        Ok(self.player.SystemMediaTransportControls()?)
    }

    fn remove_handlers(&self) -> Result<()> {
        let smtc = self.smtc()?;
        smtc.RemoveButtonPressed(self.tokens.button_pressed)?;
        smtc.RemoveShuffleEnabledChangeRequested(self.tokens.shuffle_changed)?;
        smtc.RemoveAutoRepeatModeChangeRequested(self.tokens.repeat_changed)?;
        smtc.RemovePlaybackPositionChangeRequested(self.tokens.seek_requested)?;
        smtc.RemovePlaybackRateChangeRequested(self.tokens.rate_changed)?;
        Ok(())
    }
}

impl Drop for SmtcContext {
    fn drop(&mut self) {
        let _ = self.remove_handlers();
        if let Ok(smtc) = self.smtc() {
            let _ = smtc.SetIsEnabled(false);
        }
    }
}

static CTX: LazyLock<Mutex<Option<SmtcContext>>> = LazyLock::new(|| Mutex::new(None));

fn dispatch(event: MediaEvent) {
    let cb: Option<Arc<MediaThreadsafeFunction>> = CTX
        .lock()
        .ok()
        .and_then(|g| g.as_ref().and_then(|ctx| ctx.callback.clone()));

    if let Some(tsfn) = cb {
        tsfn.call(event, ThreadsafeFunctionCallMode::NonBlocking);
    }
}

fn with_ctx<F>(f: F) -> Result<()>
where
    F: FnOnce(&mut SmtcContext) -> Result<()>,
{
    let mut guard = CTX
        .lock()
        .map_err(|e| anyhow::anyhow!("SMTC 锁失败: {e}"))?;
    if let Some(ctx) = guard.as_mut() {
        f(ctx)
    } else {
        Ok(())
    }
}

async fn make_cover_stream(data: Option<Vec<u8>>) -> Option<RandomAccessStreamReference> {
    let bytes = data?;
    let r: windows::core::Result<RandomAccessStreamReference> = (async {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        writer.StoreAsync()?.await?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        RandomAccessStreamReference::CreateFromStream(&stream)
    })
    .await;
    r.ok()
}

pub struct WindowsImpl;

impl WindowsImpl {
    pub const fn new() -> Self {
        Self
    }
}

impl SystemMediaControls for WindowsImpl {
    fn initialize(&self) -> Result<()> {
        let player = MediaPlayer::new()?;
        let smtc = player.SystemMediaTransportControls()?;

        smtc.SetIsEnabled(false)?;
        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsStopEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;

        let btn_handler = TypedEventHandler::new(
            move |_: Ref<SystemMediaTransportControls>,
                  args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let evt = match args.Button()? {
                        SystemMediaTransportControlsButton::Play => {
                            Some(MediaEvent::new(MediaEventType::Play))
                        }
                        SystemMediaTransportControlsButton::Pause => {
                            Some(MediaEvent::new(MediaEventType::Pause))
                        }
                        SystemMediaTransportControlsButton::Stop => {
                            Some(MediaEvent::new(MediaEventType::Stop))
                        }
                        SystemMediaTransportControlsButton::Next => {
                            Some(MediaEvent::new(MediaEventType::NextTrack))
                        }
                        SystemMediaTransportControlsButton::Previous => {
                            Some(MediaEvent::new(MediaEventType::PrevTrack))
                        }
                        _ => None,
                    };
                    if let Some(e) = evt {
                        dispatch(e);
                    }
                }
                Ok(())
            },
        );
        let button_pressed = smtc.ButtonPressed(&btn_handler)?;

        let shuffle_changed =
            smtc.ShuffleEnabledChangeRequested(&TypedEventHandler::new(move |_, _| {
                dispatch(MediaEvent::new(MediaEventType::ToggleShuffle));
                Ok(())
            }))?;

        let repeat_changed =
            smtc.AutoRepeatModeChangeRequested(&TypedEventHandler::new(move |_, _| {
                dispatch(MediaEvent::new(MediaEventType::ToggleRepeat));
                Ok(())
            }))?;

        let seek_requested = smtc.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_, args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let pos_ms = (args.RequestedPlaybackPosition()?.Duration as f64) / HNS_PER_MS;
                    dispatch(MediaEvent::seek(pos_ms));
                }
                Ok(())
            },
        ))?;

        let rate_changed = smtc.PlaybackRateChangeRequested(&TypedEventHandler::new(
            move |_, args: Ref<PlaybackRateChangeRequestedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    dispatch(MediaEvent::set_rate(args.RequestedPlaybackRate()?));
                }
                Ok(())
            },
        ))?;

        let context = SmtcContext {
            player,
            tokens: SmtcTokens {
                button_pressed,
                shuffle_changed,
                repeat_changed,
                seek_requested,
                rate_changed,
            },
            callback: None,
            cover_generation: 0,
            is_enabled: false,
        };

        if let Ok(mut g) = CTX.lock() {
            *g = Some(context);
        }
        Ok(())
    }

    fn enable(&self) -> Result<()> {
        with_ctx(|ctx| {
            ctx.is_enabled = true;
            Ok(ctx.smtc()?.SetIsEnabled(true)?)
        })
    }

    fn disable(&self) -> Result<()> {
        with_ctx(|ctx| {
            ctx.is_enabled = false;
            Ok(ctx.smtc()?.SetIsEnabled(false)?)
        })
    }

    fn shutdown(&self) -> Result<()> {
        if let Ok(mut g) = CTX.lock() {
            *g = None;
        }
        Ok(())
    }

    fn register_event_handler(&self, callback: MediaThreadsafeFunction) -> Result<()> {
        if let Ok(mut g) = CTX.lock() {
            if let Some(ctx) = g.as_mut() {
                ctx.callback = Some(Arc::new(callback));
            }
        }
        Ok(())
    }

    fn update_metadata(&self, payload: MetadataPayload) {
        let Ok(mut guard) = CTX.lock() else { return };
        let Some(ctx) = guard.as_mut() else { return };
        if !ctx.is_enabled {
            return;
        }

        // 递增代数，旧的异步任务发现代数过期后自行放弃，
        // 不使用 abort() 以避免 WinRT InMemoryRandomAccessStream 得不到正确 Close
        ctx.cover_generation += 1;
        let generation = ctx.cover_generation;

        let title = payload.title.clone();
        let artist = payload.artist.clone();
        let album = payload.album.clone();
        let cover_data = payload.cover_data;

        TOKIO_RT.spawn(async move {
            // 异步创建封面流（WinRT 资源在 await 完成后正常释放）
            let thumb = make_cover_stream(cover_data).await;
            let _ = with_ctx(|inner| {
                // 代数过期说明有更新的 update_metadata 已发起，放弃本次更新
                if inner.cover_generation != generation || !inner.is_enabled {
                    return Ok(());
                }
                let smtc = inner.smtc()?;
                let updater = smtc.DisplayUpdater()?;
                updater.SetType(MediaPlaybackType::Music)?;
                let props = updater.MusicProperties()?;
                props.SetTitle(&HSTRING::from(&title))?;
                props.SetArtist(&HSTRING::from(&artist))?;
                props.SetAlbumTitle(&HSTRING::from(&album))?;
                if let Some(ref stream_ref) = thumb {
                    updater.SetThumbnail(stream_ref)?;
                } else {
                    updater.SetThumbnail(None)?;
                }
                updater.Update()?;
                Ok(())
            });
        });
    }

    fn update_playback_status(&self, payload: PlayStateParam) {
        let status = match payload.status {
            AppPlaybackStatus::Playing => MediaPlaybackStatus::Playing,
            AppPlaybackStatus::Paused => MediaPlaybackStatus::Paused,
        };
        TOKIO_RT.spawn(async move {
            let _ = with_ctx(|ctx| {
                if ctx.is_enabled {
                    ctx.smtc()?.SetPlaybackStatus(status)?;
                }
                Ok(())
            });
        });
    }

    fn update_playback_rate(&self, rate: f64) {
        TOKIO_RT.spawn(async move {
            let _ = with_ctx(|ctx| {
                if ctx.is_enabled {
                    ctx.smtc()?.SetPlaybackRate(rate)?;
                }
                Ok(())
            });
        });
    }

    fn update_volume(&self, _volume: f64) {}

    fn update_timeline(&self, payload: TimelineParam) {
        TOKIO_RT.spawn(async move {
            let _ = (|| -> Result<()> {
                let props = SystemMediaTransportControlsTimelineProperties::new()?;
                props.SetStartTime(TimeSpan { Duration: 0 })?;
                props.SetPosition(TimeSpan {
                    Duration: (payload.current_ms * HNS_PER_MS) as i64,
                })?;
                props.SetEndTime(TimeSpan {
                    Duration: (payload.total_ms * HNS_PER_MS) as i64,
                })?;
                with_ctx(|ctx| {
                    if ctx.is_enabled {
                        ctx.smtc()?.UpdateTimelineProperties(&props)?;
                    }
                    Ok(())
                })
            })();
        });
    }

    fn update_play_mode(&self, payload: PlayModeParam) {
        TOKIO_RT.spawn(async move {
            let _ = with_ctx(|ctx| {
                if !ctx.is_enabled {
                    return Ok(());
                }
                let smtc = ctx.smtc()?;
                smtc.SetShuffleEnabled(payload.shuffle)?;
                let mode = match payload.repeat {
                    RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
                    RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
                    RepeatMode::None => MediaPlaybackAutoRepeatMode::None,
                };
                smtc.SetAutoRepeatMode(mode)?;
                Ok(())
            });
        });
    }
}
