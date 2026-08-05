use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use anyhow::Result;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use tracing::warn;
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
    Win32::System::Com::{CO_MTA_USAGE_COOKIE, CoDecrementMTAUsage, CoIncrementMTAUsage},
    core::{HSTRING, Ref},
};

use super::{MediaThreadsafeFunction, SystemMediaControls};
use crate::model::{
    MediaEvent, MediaEventType, MetadataPayload, PlayModeParam, PlayStateParam,
    PlaybackStatus as AppPlaybackStatus, RepeatMode, TimelineParam,
};

const HNS_PER_MS: f64 = 10_000.0;

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
    callback: Arc<Mutex<Option<Arc<MediaThreadsafeFunction>>>>,
    is_enabled: bool,
    has_metadata: bool,
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

fn dispatch(callback: &Mutex<Option<Arc<MediaThreadsafeFunction>>>, event: MediaEvent) {
    let cb = callback.lock().ok().and_then(|callback| callback.clone());

    if let Some(tsfn) = cb {
        tsfn.call(event, ThreadsafeFunctionCallMode::NonBlocking);
    }
}

async fn make_cover_stream(data: Option<Vec<u8>>) -> Result<Option<RandomAccessStreamReference>> {
    let Some(bytes) = data else {
        return Ok(None);
    };
    let stream = async {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        writer.StoreAsync()?.await?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        RandomAccessStreamReference::CreateFromStream(&stream)
    }
    .await?;
    Ok(Some(stream))
}

fn update_display(
    ctx: &SmtcContext,
    title: &str,
    artist: &str,
    album: &str,
    thumb: Option<&RandomAccessStreamReference>,
) -> Result<()> {
    let smtc = ctx.smtc()?;
    let updater = smtc.DisplayUpdater()?;
    updater.SetType(MediaPlaybackType::Music)?;
    let props = updater.MusicProperties()?;
    props.SetTitle(&HSTRING::from(title))?;
    props.SetArtist(&HSTRING::from(artist))?;
    props.SetAlbumTitle(&HSTRING::from(album))?;
    updater.SetThumbnail(thumb)?;
    updater.Update()?;
    Ok(())
}

struct MtaUsage(CO_MTA_USAGE_COOKIE);

impl MtaUsage {
    fn enter() -> Result<Self> {
        // SAFETY: cookie 只保存在当前 actor 线程，并由 Drop 在同一线程配对释放。
        Ok(Self(unsafe { CoIncrementMTAUsage()? }))
    }
}

impl Drop for MtaUsage {
    fn drop(&mut self) {
        // SAFETY: cookie 来自本线程成功的 CoIncrementMTAUsage，且只释放一次。
        unsafe {
            let _ = CoDecrementMTAUsage(self.0);
        }
    }
}

enum SmtcCommand {
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

pub struct WindowsImpl {
    sender: Mutex<Option<SyncSender<SmtcCommand>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    latest_timeline: Arc<Mutex<Option<TimelineParam>>>,
}

impl WindowsImpl {
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
            .map_err(|error| anyhow::anyhow!("SMTC sender 锁失败: {error}"))?;
        if sender.is_some() {
            return Ok(());
        }
        let (command_tx, command_rx) = mpsc::sync_channel(16);
        let (ready_tx, ready_rx) = mpsc::channel();
        let latest_timeline = Arc::clone(&self.latest_timeline);
        let thread = thread::Builder::new()
            .name("smtc-actor".to_string())
            .spawn(move || {
                let result = (|| -> Result<()> {
                    let _mta = MtaUsage::enter()?;
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()?;
                    let mut context = initialize_context()?;
                    let _ = ready_tx.send(Ok(()));
                    worker_loop(&command_rx, &runtime, &latest_timeline, &mut context);
                    Ok(())
                })();
                if let Err(error) = result {
                    let _ = ready_tx.send(Err(error.to_string()));
                }
            })?;

        match ready_rx.recv() {
            Ok(Ok(())) => {
                *sender = Some(command_tx);
                *self
                    .thread
                    .lock()
                    .map_err(|error| anyhow::anyhow!("SMTC thread 锁失败: {error}"))? =
                    Some(thread);
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(anyhow::anyhow!(error))
            }
            Err(error) => {
                let _ = thread.join();
                Err(anyhow::anyhow!("SMTC ready 握手失败: {error}"))
            }
        }
    }

    fn sender(&self) -> Result<SyncSender<SmtcCommand>> {
        self.sender
            .lock()
            .map_err(|error| anyhow::anyhow!("SMTC sender 锁失败: {error}"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("SMTC 尚未初始化"))
    }

    fn request(
        &self,
        build: impl FnOnce(mpsc::Sender<Result<(), String>>) -> SmtcCommand,
    ) -> Result<()> {
        let (result_tx, result_rx) = mpsc::channel();
        self.sender()?.send(build(result_tx))?;
        result_rx
            .recv()
            .map_err(|error| anyhow::anyhow!("SMTC actor 响应失败: {error}"))?
            .map_err(anyhow::Error::msg)
    }

    fn send_update(&self, command: SmtcCommand) {
        if let Ok(sender) = self.sender() {
            // 元数据和状态是低频且不可丢的；有界队列满时施加背压，避免系统界面永久停留在旧状态。
            let _ = sender.send(command);
        }
    }

    fn send_timeline(&self) {
        if let Ok(sender) = self.sender() {
            // 时间轴由 latest_timeline 合并，队列繁忙时丢弃通知不会丢失下一次最新位置。
            let _ = sender.try_send(SmtcCommand::Timeline);
        }
    }
}

fn initialize_context() -> Result<SmtcContext> {
    let player = MediaPlayer::new()?;
    let smtc = player.SystemMediaTransportControls()?;
    let callback = Arc::new(Mutex::new(None::<Arc<MediaThreadsafeFunction>>));

    smtc.SetIsEnabled(false)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsStopEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;

    let button_callback = Arc::clone(&callback);
    let btn_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let event = match args.Button()? {
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
                if let Some(event) = event {
                    dispatch(&button_callback, event);
                }
            }
            Ok(())
        },
    );
    let button_pressed = smtc.ButtonPressed(&btn_handler)?;
    let shuffle_callback = Arc::clone(&callback);
    let shuffle_changed =
        smtc.ShuffleEnabledChangeRequested(&TypedEventHandler::new(move |_, _| {
            dispatch(
                &shuffle_callback,
                MediaEvent::new(MediaEventType::ToggleShuffle),
            );
            Ok(())
        }))?;
    let repeat_callback = Arc::clone(&callback);
    let repeat_changed =
        smtc.AutoRepeatModeChangeRequested(&TypedEventHandler::new(move |_, _| {
            dispatch(
                &repeat_callback,
                MediaEvent::new(MediaEventType::ToggleRepeat),
            );
            Ok(())
        }))?;
    let seek_callback = Arc::clone(&callback);
    let seek_requested = smtc.PlaybackPositionChangeRequested(&TypedEventHandler::new(
        move |_, args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let position_ms = args.RequestedPlaybackPosition()?.Duration as f64 / HNS_PER_MS;
                dispatch(&seek_callback, MediaEvent::seek(position_ms));
            }
            Ok(())
        },
    ))?;
    let rate_callback = Arc::clone(&callback);
    let rate_changed = smtc.PlaybackRateChangeRequested(&TypedEventHandler::new(
        move |_, args: Ref<PlaybackRateChangeRequestedEventArgs>| {
            if let Some(args) = args.as_ref() {
                dispatch(
                    &rate_callback,
                    MediaEvent::set_rate(args.RequestedPlaybackRate()?),
                );
            }
            Ok(())
        },
    ))?;

    Ok(SmtcContext {
        player,
        tokens: SmtcTokens {
            button_pressed,
            shuffle_changed,
            repeat_changed,
            seek_requested,
            rate_changed,
        },
        callback,
        is_enabled: false,
        has_metadata: false,
    })
}

fn worker_loop(
    receiver: &mpsc::Receiver<SmtcCommand>,
    runtime: &tokio::runtime::Runtime,
    latest_timeline: &Mutex<Option<TimelineParam>>,
    context: &mut SmtcContext,
) {
    while let Ok(command) = receiver.recv() {
        match command {
            SmtcCommand::Enable(result) => {
                let outcome: Result<()> = (|| {
                    context.is_enabled = true;
                    context.smtc()?.SetIsEnabled(true)?;
                    if !context.has_metadata {
                        update_display(context, "SPlayer Next", "", "", None)?;
                        context.has_metadata = true;
                    }
                    Ok(())
                })();
                let _ = result.send(outcome.map_err(|error| error.to_string()));
            }
            SmtcCommand::Disable(result) => {
                let outcome: Result<()> = (|| {
                    context.is_enabled = false;
                    context.smtc()?.SetIsEnabled(false)?;
                    Ok(())
                })();
                let _ = result.send(outcome.map_err(|error| error.to_string()));
            }
            SmtcCommand::Register(callback, result) => {
                let outcome: Result<()> = (|| {
                    *context
                        .callback
                        .lock()
                        .map_err(|error| anyhow::anyhow!("SMTC callback 锁失败: {error}"))? =
                        Some(Arc::new(callback));
                    Ok(())
                })();
                let _ = result.send(outcome.map_err(|error| error.to_string()));
            }
            SmtcCommand::Metadata(payload) => {
                let thumbnail = match runtime.block_on(make_cover_stream(payload.cover_data)) {
                    Ok(thumbnail) => thumbnail,
                    Err(error) => {
                        warn!(%error, "创建 SMTC 封面流失败");
                        None
                    }
                };
                if let Err(error) = (|| -> Result<()> {
                    if !context.is_enabled {
                        return Ok(());
                    }
                    update_display(
                        context,
                        &payload.title,
                        &payload.artist,
                        &payload.album,
                        thumbnail.as_ref(),
                    )?;
                    context.has_metadata = true;
                    Ok(())
                })() {
                    warn!(%error, "更新 SMTC metadata 失败");
                }
            }
            SmtcCommand::PlaybackStatus(payload) => {
                let status = match payload.status {
                    AppPlaybackStatus::Playing => MediaPlaybackStatus::Playing,
                    AppPlaybackStatus::Paused => MediaPlaybackStatus::Paused,
                };
                if let Err(error) = (|| -> Result<()> {
                    if context.is_enabled {
                        context.smtc()?.SetPlaybackStatus(status)?;
                    }
                    Ok(())
                })() {
                    warn!(%error, "更新 SMTC 播放状态失败");
                }
            }
            SmtcCommand::PlaybackRate(rate) => {
                if let Err(error) = (|| -> Result<()> {
                    if context.is_enabled {
                        context.smtc()?.SetPlaybackRate(rate)?;
                    }
                    Ok(())
                })() {
                    warn!(%error, "更新 SMTC 播放速率失败");
                }
            }
            SmtcCommand::Timeline => {
                let payload = latest_timeline
                    .lock()
                    .ok()
                    .and_then(|mut timeline| timeline.take());
                if let Some(payload) = payload
                    && let Err(error) = (|| -> Result<()> {
                        let properties = SystemMediaTransportControlsTimelineProperties::new()?;
                        properties.SetStartTime(TimeSpan { Duration: 0 })?;
                        properties.SetPosition(TimeSpan {
                            Duration: (payload.current_ms * HNS_PER_MS) as i64,
                        })?;
                        properties.SetEndTime(TimeSpan {
                            Duration: (payload.total_ms * HNS_PER_MS) as i64,
                        })?;
                        if context.is_enabled {
                            context.smtc()?.UpdateTimelineProperties(&properties)?;
                        }
                        Ok(())
                    })()
                {
                    warn!(%error, "更新 SMTC 时间轴失败");
                }
            }
            SmtcCommand::PlayMode(payload) => {
                if let Err(error) = (|| -> Result<()> {
                    if !context.is_enabled {
                        return Ok(());
                    }
                    let smtc = context.smtc()?;
                    smtc.SetShuffleEnabled(payload.shuffle)?;
                    let mode = match payload.repeat {
                        RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
                        RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
                        RepeatMode::None => MediaPlaybackAutoRepeatMode::None,
                    };
                    smtc.SetAutoRepeatMode(mode)?;
                    Ok(())
                })() {
                    warn!(%error, "更新 SMTC 播放模式失败");
                }
            }
            SmtcCommand::Shutdown(acknowledge) => {
                let _ = acknowledge.send(());
                break;
            }
        }
    }
}

impl SystemMediaControls for WindowsImpl {
    fn initialize(&self) -> Result<()> {
        self.start()
    }

    fn enable(&self) -> Result<()> {
        self.request(SmtcCommand::Enable)
    }

    fn disable(&self) -> Result<()> {
        self.request(SmtcCommand::Disable)
    }

    fn shutdown(&self) -> Result<()> {
        let sender = self
            .sender
            .lock()
            .map_err(|error| anyhow::anyhow!("SMTC sender 锁失败: {error}"))?
            .take();
        if let Some(sender) = sender {
            let (acknowledge_tx, acknowledge_rx) = mpsc::channel();
            let _ = sender.send(SmtcCommand::Shutdown(acknowledge_tx));
            drop(sender);
            let _ = acknowledge_rx.recv();
        }
        if let Some(thread) = self
            .thread
            .lock()
            .map_err(|error| anyhow::anyhow!("SMTC thread 锁失败: {error}"))?
            .take()
        {
            let _ = thread.join();
        }
        Ok(())
    }

    fn register_event_handler(&self, callback: MediaThreadsafeFunction) -> Result<()> {
        self.request(|result| SmtcCommand::Register(callback, result))
    }

    fn update_metadata(&self, payload: MetadataPayload) {
        self.send_update(SmtcCommand::Metadata(payload));
    }

    fn update_playback_status(&self, payload: PlayStateParam) {
        self.send_update(SmtcCommand::PlaybackStatus(payload));
    }

    fn update_playback_rate(&self, rate: f64) {
        self.send_update(SmtcCommand::PlaybackRate(rate));
    }

    fn update_volume(&self, _volume: f64) {}

    fn update_timeline(&self, payload: TimelineParam) {
        if let Ok(mut latest) = self.latest_timeline.lock() {
            *latest = Some(payload);
        }
        self.send_timeline();
    }

    fn update_play_mode(&self, payload: PlayModeParam) {
        self.send_update(SmtcCommand::PlayMode(payload));
    }
}
