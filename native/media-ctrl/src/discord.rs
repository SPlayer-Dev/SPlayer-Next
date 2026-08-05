use std::{
    sync::{
        OnceLock,
        mpsc::{self, Receiver, SyncSender},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use discord_rich_presence::{
    DiscordIpc, DiscordIpcClient,
    activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps},
};
use tracing::{debug, info};
use url::Url;

use crate::model::{
    DiscordConfig, DiscordDisplayMode, MetadataPayload, PlayStateParam, PlaybackStatus,
    TimelineParam,
};

const APP_ID: &str = "1454403710162698293";
const ICON_KEY: &str = "logo-icon";
const TIMESTAMP_THRESHOLD_MS: i64 = 100;
const RECONNECT_COOLDOWN: Duration = Duration::from_secs(5);

enum Msg {
    Metadata(MetadataPayload),
    PlayState(PlayStateParam),
    Timeline(TimelineParam),
    Enable,
    Disable,
    Config(DiscordConfig),
}

static ACTOR: OnceLock<std::sync::Mutex<Option<ActorHandle>>> = OnceLock::new();

struct ActorHandle {
    sender: SyncSender<Msg>,
    join: Option<thread::JoinHandle<()>>,
}

#[derive(Clone, PartialEq)]
struct ActivityData {
    meta: MetadataPayload,
    status: PlaybackStatus,
    current_ms: f64,
    cover_url: String,
}

impl ActivityData {
    fn from_meta(meta: MetadataPayload) -> Self {
        let cover_url = Self::process_cover(meta.cover_url.as_deref());
        Self {
            meta,
            status: PlaybackStatus::Paused,
            current_ms: 0.0,
            cover_url,
        }
    }

    fn set_meta(&mut self, meta: MetadataPayload) {
        self.cover_url = Self::process_cover(meta.cover_url.as_deref());
        self.meta = meta;
        self.current_ms = 0.0;
    }

    fn process_cover(url: Option<&str>) -> String {
        let Some(raw) = url else {
            return ICON_KEY.to_string();
        };
        let Ok(mut parsed) = Url::parse(raw) else {
            return ICON_KEY.to_string();
        };
        if !matches!(parsed.scheme(), "http" | "https") {
            return ICON_KEY.to_string();
        }
        if parsed.scheme() == "http" && parsed.set_scheme("https").is_err() {
            return ICON_KEY.to_string();
        }
        parsed.set_query(None);
        parsed.set_fragment(None);
        parsed.to_string()
    }
}

struct Worker {
    client: Option<DiscordIpcClient>,
    data: Option<ActivityData>,
    enabled: bool,
    next_retry_at: Option<std::time::Instant>,
    last_end_ts: Option<i64>,
    show_paused: bool,
    display_mode: DiscordDisplayMode,
    /// 元数据/状态/配置变更后置位，保证无时长曲目（电台/流）也至少发送一次 activity
    dirty: bool,
}

impl Default for Worker {
    fn default() -> Self {
        Self {
            client: None,
            data: None,
            enabled: false,
            next_retry_at: None,
            last_end_ts: None,
            show_paused: false,
            display_mode: DiscordDisplayMode::Name,
            dirty: false,
        }
    }
}

impl Worker {
    fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::Enable => {
                self.enabled = true;
                self.next_retry_at = None;
            }
            Msg::Disable => {
                self.enabled = false;
                self.disconnect();
            }
            Msg::Config(c) => {
                self.show_paused = c.show_when_paused;
                if let Some(m) = c.display_mode {
                    self.display_mode = m;
                }
                self.last_end_ts = None;
                self.dirty = true;
            }
            Msg::Metadata(m) => {
                match self.data.as_mut() {
                    Some(d) => d.set_meta(m),
                    None => self.data = Some(ActivityData::from_meta(m)),
                }
                self.last_end_ts = None;
                self.dirty = true;
            }
            Msg::PlayState(p) => {
                if let Some(d) = &mut self.data {
                    if p.status == PlaybackStatus::Playing && d.status != PlaybackStatus::Playing {
                        self.last_end_ts = None;
                    }
                    d.status = p.status;
                    self.dirty = true;
                }
            }
            Msg::Timeline(t) => {
                if let Some(d) = &mut self.data {
                    d.current_ms = t.current_ms;
                }
            }
        }
    }

    fn disconnect(&mut self) {
        if let Some(mut c) = self.client.take() {
            debug!("断开 Discord IPC 连接");
            let _ = c.close();
        }
        self.last_end_ts = None;
    }

    fn connect(&mut self) {
        if let Some(t) = self.next_retry_at
            && std::time::Instant::now() < t
        {
            return;
        }
        let mut client = DiscordIpcClient::new(APP_ID);
        match client.connect() {
            Ok(()) => {
                info!("Discord IPC 已连接");
                self.client = Some(client);
                self.last_end_ts = None;
                self.next_retry_at = None;
            }
            Err(e) => {
                debug!(
                    error = %e,
                    cooldown_secs = RECONNECT_COOLDOWN.as_secs(),
                    "Discord IPC 连接失败，进入冷却"
                );
                self.next_retry_at = Some(std::time::Instant::now() + RECONNECT_COOLDOWN);
            }
        }
    }

    fn sync(&mut self) {
        if !self.enabled {
            if self.client.is_some() {
                self.disconnect();
            }
            return;
        }
        if self.data.is_none() {
            if let Some(c) = &mut self.client {
                let _ = c.clear_activity();
                self.last_end_ts = None;
            }
            return;
        }
        if self.client.is_none() {
            self.connect();
        }

        if let (Some(client), Some(data)) = (&mut self.client, &self.data)
            && !Self::do_update(
                client,
                data,
                &mut self.last_end_ts,
                &mut self.dirty,
                self.show_paused,
                self.display_mode,
            )
        {
            self.disconnect();
        }
    }

    fn do_update(
        client: &mut DiscordIpcClient,
        data: &ActivityData,
        last_end: &mut Option<i64>,
        dirty: &mut bool,
        show_paused: bool,
        display_mode: DiscordDisplayMode,
    ) -> bool {
        let assets = Assets::new()
            .large_image(&data.cover_url)
            .large_text(&data.meta.album)
            .small_image(ICON_KEY)
            .small_text("SPlayer");

        let buttons = vec![Button::new("SPlayer", "https://github.com/imsyy/SPlayer")];

        let status_type = match display_mode {
            DiscordDisplayMode::Name => StatusDisplayType::Name,
            DiscordDisplayMode::State => StatusDisplayType::State,
            DiscordDisplayMode::Details => StatusDisplayType::Details,
        };

        let mut activity = Activity::new()
            .details(&data.meta.title)
            .state(&data.meta.artist)
            .activity_type(ActivityType::Listening)
            .assets(assets)
            .buttons(buttons)
            .status_display_type(status_type);

        let should_send;

        match data.status {
            PlaybackStatus::Paused => {
                if !show_paused {
                    if let Err(e) = client.clear_activity() {
                        debug!(error = %e, "Discord clear_activity 失败，断开重连");
                        return false;
                    }
                    *last_end = None;
                    return true;
                }
                if let Some(dur) = data.meta.duration_ms
                    && dur > 0.0
                {
                    let (s, e) = paused_timestamps(data.current_ms, dur);
                    activity = activity
                        .timestamps(Timestamps::new().start(s).end(e))
                        .assets(
                            Assets::new()
                                .large_image(&data.cover_url)
                                .large_text(&data.meta.album)
                                .small_image(ICON_KEY)
                                .small_text("Paused"),
                        );
                }
                should_send = true;
                *last_end = None;
            }
            PlaybackStatus::Playing => {
                if let Some(dur) = data.meta.duration_ms
                    && dur > 0.0
                {
                    let (s, e) = playing_timestamps(data.current_ms, dur);
                    if let Some(prev) = last_end
                        && (*prev - e).abs() < TIMESTAMP_THRESHOLD_MS
                    {
                        return true;
                    }
                    activity = activity.timestamps(Timestamps::new().start(s).end(e));
                    *last_end = Some(e);
                    should_send = true;
                } else {
                    // 无时长曲目（电台/流）没有时间戳可比对，靠 dirty 标志保证
                    // 元数据变更后至少发送一次，否则会一直残留上一首的信息
                    should_send = *dirty;
                }
            }
        }

        if should_send {
            if let Err(e) = client.set_activity(activity) {
                debug!(error = %e, "Discord set_activity 失败，断开重连");
                return false;
            }
            *dirty = false;
        }
        true
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn playing_timestamps(current: f64, duration: f64) -> (i64, i64) {
    if current >= duration {
        return (0, 0);
    }
    let now = now_ms();
    let remaining = (duration as i64 - current as i64).max(0);
    let end = now + remaining;
    (end - duration as i64, end)
}

fn paused_timestamps(current: f64, duration: f64) -> (i64, i64) {
    const ONE_YEAR_MS: i64 = 365 * 24 * 60 * 60 * 1000;
    let now = now_ms();
    let start = (now - current as i64) + ONE_YEAR_MS;
    (start, start + duration as i64)
}

fn background_loop(rx: Receiver<Msg>) {
    let mut worker = Worker::default();
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(msg) => {
                worker.handle(msg);
                worker.sync();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if worker.client.is_none() {
                    worker.sync();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

pub fn init() -> anyhow::Result<()> {
    let actor = ACTOR.get_or_init(|| std::sync::Mutex::new(None));
    let mut actor = actor
        .lock()
        .map_err(|error| anyhow::anyhow!("Discord actor 锁失败: {error}"))?;
    if actor.is_some() {
        return Ok(());
    }
    let (tx, rx) = mpsc::sync_channel(32);
    let join = thread::Builder::new()
        .name("discord-rpc-actor".to_string())
        .spawn(move || background_loop(rx))?;
    *actor = Some(ActorHandle {
        sender: tx,
        join: Some(join),
    });
    info!("Discord RPC 后台线程已启动");
    Ok(())
}

fn send(msg: Msg) {
    let Some(actor) = ACTOR.get() else {
        return;
    };
    let sender = actor
        .lock()
        .ok()
        .and_then(|actor| actor.as_ref().map(|actor| actor.sender.clone()));
    if let Some(sender) = sender {
        // 配置、元数据和播放状态必须按序送达；队列有界，满时通过背压限制生产者。
        let _ = sender.send(msg);
    }
}

fn send_timeline(msg: Msg) {
    let Some(actor) = ACTOR.get() else {
        return;
    };
    let sender = actor
        .lock()
        .ok()
        .and_then(|actor| actor.as_ref().map(|actor| actor.sender.clone()));
    if let Some(sender) = sender {
        // 时间轴是高频快照，队列繁忙时下一次更新会取代本次，无需阻塞播放主链路。
        let _ = sender.try_send(msg);
    }
}

/// 停止 Discord actor 并等待线程退出，下一次 initialize 可以重新创建。
pub fn shutdown() {
    let Some(actor) = ACTOR.get() else {
        return;
    };
    let Ok(mut actor) = actor.lock() else {
        return;
    };
    let Some(mut actor_handle) = actor.take() else {
        return;
    };
    let _ = actor_handle.sender.send(Msg::Disable);
    drop(actor_handle.sender);
    if let Some(join) = actor_handle.join.take() {
        let _ = join.join();
    }
}

pub fn enable() {
    send(Msg::Enable);
}
pub fn update_config(c: DiscordConfig) {
    send(Msg::Config(c));
}
pub fn update_metadata(p: MetadataPayload) {
    send(Msg::Metadata(p));
}
pub fn update_play_state(p: PlayStateParam) {
    send(Msg::PlayState(p));
}
pub fn update_timeline(p: TimelineParam) {
    send_timeline(Msg::Timeline(p));
}

#[cfg(test)]
mod tests {
    use super::{ActivityData, ICON_KEY};

    #[test]
    fn cover_url_removes_credentials_query_and_fragment_from_presence() {
        let cover = ActivityData::process_cover(Some(
            "https://cdn.example/cover.jpg?token=secret#fragment",
        ));
        assert_eq!(cover, "https://cdn.example/cover.jpg");
    }

    #[test]
    fn cover_url_rejects_non_http_protocols() {
        assert_eq!(
            ActivityData::process_cover(Some("file:///tmp/cover.jpg")),
            ICON_KEY
        );
        assert_eq!(ActivityData::process_cover(Some("not a url")), ICON_KEY);
    }

    #[test]
    fn http_cover_is_upgraded_without_string_slicing() {
        assert_eq!(
            ActivityData::process_cover(Some("http://cdn.example/cover.jpg")),
            "https://cdn.example/cover.jpg"
        );
    }
}
