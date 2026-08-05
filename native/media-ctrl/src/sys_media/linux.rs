use std::{
    io::Write,
    process,
    sync::{Arc, Mutex, RwLock, mpsc as std_mpsc},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Result;
use mpris_server::{
    LoopStatus as MprisLoopStatus, Metadata, PlaybackStatus as MprisPlaybackStatus, Player, Time,
    zbus::zvariant::ObjectPath,
};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use tempfile::NamedTempFile;
use tokio::{
    runtime::Runtime,
    sync::mpsc::{Receiver, Sender, channel},
};
use tracing::{error, warn};

use super::{MediaThreadsafeFunction, SystemMediaControls};
use crate::model::{
    MediaEvent, MediaEventType, MetadataPayload, PlayModeParam, PlayStateParam, PlaybackStatus,
    RepeatMode, TimelineParam,
};

enum MprisCommand {
    UpdateMetadata(MetadataPayload),
    UpdatePlaybackStatus(PlayStateParam),
    UpdatePlaybackRate(f64),
    UpdateVolume(f64),
    UpdateTimeline(TimelineParam),
    UpdatePlayMode(PlayModeParam),
    Enable,
    Disable,
    RegisterCallback(MediaThreadsafeFunction),
    Shutdown,
}

pub struct LinuxImpl {
    sender: Mutex<Option<Sender<MprisCommand>>>,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
}

impl LinuxImpl {
    pub fn new() -> Self {
        Self {
            sender: Mutex::new(None),
            thread: Mutex::new(None),
        }
    }

    fn start(&self) -> Result<()> {
        let mut sender = self
            .sender
            .lock()
            .map_err(|e| anyhow::anyhow!("MPRIS sender 锁失败: {e}"))?;
        if sender.is_some() {
            return Ok(());
        }

        let (tx, rx) = channel(32);
        let (ready_tx, ready_rx) = std_mpsc::channel();

        let thread = thread::spawn(move || {
            let rt = match Runtime::new() {
                Ok(r) => r,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("无法创建 MPRIS Tokio Runtime: {e:?}")));
                    return;
                }
            };
            rt.block_on(async move {
                if let Err(e) = run_mpris_loop(rx, ready_tx).await {
                    error!(error = %e, "MPRIS 循环异常退出");
                }
            });
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {
                *sender = Some(tx);
                if let Ok(mut current) = self.thread.lock() {
                    *current = Some(thread);
                }
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(anyhow::anyhow!(error))
            }
            Err(error) => {
                let _ = thread.join();
                Err(anyhow::anyhow!("MPRIS ready 握手失败: {error}"))
            }
        }
    }

    fn send_cmd(&self, cmd: MprisCommand) {
        if let Ok(sender) = self.sender.lock()
            && let Some(sender) = sender.as_ref()
        {
            // 控制、元数据和状态是低频且不可丢的，队列满时等待 actor 接收。
            let _ = sender.blocking_send(cmd);
        }
    }

    fn send_timeline(&self, timeline: TimelineParam) {
        if let Ok(sender) = self.sender.lock()
            && let Some(sender) = sender.as_ref()
        {
            // 时间轴是高频快照；有界队列繁忙时允许下一次位置覆盖本次更新。
            let _ = sender.try_send(MprisCommand::UpdateTimeline(timeline));
        }
    }

    fn send_shutdown(&self) {
        if let Ok(mut sender) = self.sender.lock()
            && let Some(sender) = sender.take()
        {
            let _ = sender.blocking_send(MprisCommand::Shutdown);
        }
    }
}

fn setup_signals(player: &Player, handler: Arc<RwLock<Option<MediaThreadsafeFunction>>>) {
    let dispatch = move |evt: MediaEvent| {
        if let Ok(guard) = handler.read()
            && let Some(tsfn) = guard.as_ref()
        {
            tsfn.call(evt, ThreadsafeFunctionCallMode::NonBlocking);
        }
    };

    let d = dispatch.clone();
    player.connect_play(move |_| d(MediaEvent::new(MediaEventType::Play)));

    let d = dispatch.clone();
    player.connect_pause(move |_| d(MediaEvent::new(MediaEventType::Pause)));

    let d = dispatch.clone();
    player.connect_play_pause(move |p| {
        let evt = if p.playback_status() == MprisPlaybackStatus::Playing {
            MediaEventType::Pause
        } else {
            MediaEventType::Play
        };
        d(MediaEvent::new(evt));
    });

    let d = dispatch.clone();
    player.connect_previous(move |_| d(MediaEvent::new(MediaEventType::PrevTrack)));

    let d = dispatch.clone();
    player.connect_next(move |_| d(MediaEvent::new(MediaEventType::NextTrack)));

    let d = dispatch.clone();
    player.connect_stop(move |_| d(MediaEvent::new(MediaEventType::Stop)));

    let d = dispatch.clone();
    player.connect_set_loop_status(move |_, _| d(MediaEvent::new(MediaEventType::ToggleRepeat)));

    let d = dispatch.clone();
    player.connect_set_shuffle(move |_, _| d(MediaEvent::new(MediaEventType::ToggleShuffle)));

    let d = dispatch.clone();
    player.connect_set_rate(move |_, rate| d(MediaEvent::set_rate(rate)));

    let d = dispatch.clone();
    player.connect_set_volume(move |_, vol| d(MediaEvent::set_volume(vol)));

    let d = dispatch.clone();
    player.connect_seek(move |p, offset| {
        let current = p.position().as_micros();
        let target = current.saturating_add(offset.as_micros()).max(0);
        d(MediaEvent::seek(target as f64 / 1000.0));
    });

    player.connect_set_position(move |_, _, pos| {
        dispatch(MediaEvent::seek(pos.as_micros() as f64 / 1000.0));
    });
}

#[allow(clippy::future_not_send)]
async fn process_metadata(
    player: &Player,
    payload: MetadataPayload,
    cover_guard: &mut Option<NamedTempFile>,
) {
    let art_url = if let Some(data) = payload.cover_data {
        match tempfile::Builder::new().suffix(".jpg").tempfile() {
            Ok(mut file) => {
                if file.write_all(&data).is_ok() {
                    match url::Url::from_file_path(file.path()) {
                        Ok(url) => {
                            *cover_guard = Some(file);
                            Some(url.to_string())
                        }
                        Err(()) => None,
                    }
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    } else if let Some(url) = payload.cover_url {
        *cover_guard = None;
        Some(url)
    } else {
        *cover_guard = None;
        None
    };

    let mut mb = Metadata::builder()
        .title(payload.title)
        .artist([payload.artist])
        .album(payload.album);

    let track_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();

    let track_path = format!("/com/splayer/track/{track_id}");
    if let Ok(op) = ObjectPath::try_from(track_path.as_str()) {
        mb = mb.trackid(op);
    }

    if let Some(dur) = payload.duration_ms {
        mb = mb.length(Time::from_millis(dur as i64));
    }

    if let Some(url) = art_url {
        mb = mb.art_url(url);
    }

    if let Err(error) = player.set_metadata(mb.build()).await {
        warn!(%error, "更新 MPRIS metadata 失败");
    }
    player.set_position(Time::from_millis(0));
}

#[allow(clippy::future_not_send)]
async fn handle_cmd(
    cmd: MprisCommand,
    player: &Player,
    handler: &Arc<RwLock<Option<MediaThreadsafeFunction>>>,
    cover_guard: &mut Option<NamedTempFile>,
) -> bool {
    match cmd {
        MprisCommand::Shutdown => return false,
        MprisCommand::RegisterCallback(cb) => {
            if let Ok(mut g) = handler.write() {
                *g = Some(cb);
            }
        }
        MprisCommand::UpdateMetadata(p) => process_metadata(player, p, cover_guard).await,
        MprisCommand::UpdatePlaybackStatus(p) => {
            let status = match p.status {
                PlaybackStatus::Playing => MprisPlaybackStatus::Playing,
                PlaybackStatus::Paused => MprisPlaybackStatus::Paused,
            };
            if let Err(error) = player.set_playback_status(status).await {
                warn!(%error, "更新 MPRIS 播放状态失败");
            }
        }
        MprisCommand::UpdatePlaybackRate(rate) => {
            if let Err(error) = player.set_rate(rate).await {
                warn!(%error, "更新 MPRIS 倍速失败");
            }
        }
        MprisCommand::UpdateVolume(vol) => {
            if let Err(error) = player.set_volume(vol).await {
                warn!(%error, "更新 MPRIS 音量失败");
            }
        }
        MprisCommand::UpdateTimeline(p) => {
            let pos = Time::from_millis(p.current_ms as i64);
            player.set_position(pos);
            if p.seeked.unwrap_or(false) {
                if let Err(error) = player.seeked(pos).await {
                    warn!(%error, "发送 MPRIS seeked 失败");
                }
            }
        }
        MprisCommand::UpdatePlayMode(p) => {
            let loop_status = match p.repeat {
                RepeatMode::None => MprisLoopStatus::None,
                RepeatMode::Track => MprisLoopStatus::Track,
                RepeatMode::List => MprisLoopStatus::Playlist,
            };
            if let Err(error) = player.set_loop_status(loop_status).await {
                warn!(%error, "更新 MPRIS 循环状态失败");
            }
            if let Err(error) = player.set_shuffle(p.shuffle).await {
                warn!(%error, "更新 MPRIS 随机状态失败");
            }
        }
        MprisCommand::Enable => {}
        MprisCommand::Disable => {
            if let Err(error) = player
                .set_playback_status(MprisPlaybackStatus::Stopped)
                .await
            {
                warn!(%error, "停止 MPRIS 状态失败");
            }
            if let Err(error) = player.set_metadata(Metadata::new()).await {
                warn!(%error, "清空 MPRIS metadata 失败");
            }
        }
    }
    true
}

#[allow(clippy::future_not_send)]
async fn run_mpris_loop(
    mut rx: Receiver<MprisCommand>,
    ready_tx: std_mpsc::Sender<Result<(), String>>,
) -> Result<()> {
    let handler = Arc::new(RwLock::new(None::<MediaThreadsafeFunction>));
    let mut cover_guard: Option<NamedTempFile> = None;

    let pid = process::id();
    let identity = format!("splayer-next.instance{pid}");

    let player = match Player::builder(&identity)
        .can_play(true)
        .can_pause(true)
        .can_go_next(true)
        .can_go_previous(true)
        .can_seek(true)
        .can_control(true)
        .minimum_rate(0.2)
        .maximum_rate(2.0)
        .playback_status(MprisPlaybackStatus::Stopped)
        .identity("SPlayer-Next")
        .desktop_entry("top.imsyy.splayer_next")
        .build()
        .await
    {
        Ok(player) => player,
        Err(error) => {
            let message = format!("MPRIS 初始化失败: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            return Err(anyhow::anyhow!(message));
        }
    };

    setup_signals(&player, handler.clone());
    let _ = ready_tx.send(Ok(()));

    let server = player.run();
    tokio::pin!(server);

    loop {
        tokio::select! {
            () = &mut server => break,
            cmd = rx.recv() => {
                let Some(cmd) = cmd else { break };
                if !handle_cmd(cmd, &player, &handler, &mut cover_guard).await {
                    break;
                }
            }
        }
    }

    Ok(())
}

impl SystemMediaControls for LinuxImpl {
    fn initialize(&self) -> Result<()> {
        self.start()
    }
    fn enable(&self) -> Result<()> {
        self.send_cmd(MprisCommand::Enable);
        Ok(())
    }
    fn disable(&self) -> Result<()> {
        self.send_cmd(MprisCommand::Disable);
        Ok(())
    }
    fn shutdown(&self) -> Result<()> {
        self.send_shutdown();
        if let Ok(mut thread) = self.thread.lock()
            && let Some(thread) = thread.take()
        {
            let _ = thread.join();
        }
        Ok(())
    }
    fn register_event_handler(&self, cb: MediaThreadsafeFunction) -> Result<()> {
        self.send_cmd(MprisCommand::RegisterCallback(cb));
        Ok(())
    }
    fn update_metadata(&self, p: MetadataPayload) {
        self.send_cmd(MprisCommand::UpdateMetadata(p));
    }
    fn update_playback_status(&self, p: PlayStateParam) {
        self.send_cmd(MprisCommand::UpdatePlaybackStatus(p));
    }
    fn update_playback_rate(&self, r: f64) {
        self.send_cmd(MprisCommand::UpdatePlaybackRate(r));
    }
    fn update_volume(&self, v: f64) {
        self.send_cmd(MprisCommand::UpdateVolume(v));
    }
    fn update_timeline(&self, p: TimelineParam) {
        self.send_timeline(p);
    }
    fn update_play_mode(&self, p: PlayModeParam) {
        self.send_cmd(MprisCommand::UpdatePlayMode(p));
    }
}
