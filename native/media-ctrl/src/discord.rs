use std::{
    sync::{
        LazyLock, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use discord_rich_presence::{
    DiscordIpc, DiscordIpcClient,
    activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps},
};
use tracing::{debug, info};

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

static SENDER: LazyLock<Mutex<Option<Sender<Msg>>>> = LazyLock::new(|| Mutex::new(None));

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
        url.map_or_else(
            || ICON_KEY.to_string(),
            |u| {
                if !u.starts_with("http") {
                    return ICON_KEY.to_string();
                }
                let u = u.replace("http://", "https://");
                u.split('?').next().unwrap_or(&u).to_string()
            },
        )
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
}

impl Default for Worker {
    fn default() -> Self {
        Self {
            client: None,
            data: None,
            enabled: false,
            retry_cd: 0,
            last_end_ts: None,
            show_paused: false,
            display_mode: DiscordDisplayMode::Name,
        }
    }
}

impl Worker {
    fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::Enable => {
                self.enabled = true;
                self.retry_cd = 0;
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
            }
            Msg::Metadata(m) => {
                match self.data.as_mut() {
                    Some(d) => d.set_meta(m),
                    None => self.data = Some(ActivityData::from_meta(m)),
                }
                self.last_end_ts = None;
            }
            Msg::PlayState(p) => {
                if let Some(d) = &mut self.data {
                    if p.status == PlaybackStatus::Playing && d.status != PlaybackStatus::Playing {
                        self.last_end_ts = None;
                    }
                    d.status = p.status;
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
        if self.retry_cd > 0 {
            self.retry_cd -= 1;
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
            Err(_) => {
                debug!(
                    cooldown = RECONNECT_COOLDOWN,
                    "Discord IPC 连接失败，进入冷却"
                );
                self.retry_cd = RECONNECT_COOLDOWN;
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

        if let (Some(client), Some(data)) = (&mut self.client, &self.data) {
            if !Self::do_update(
                client,
                data,
                &mut self.last_end_ts,
                self.show_paused,
                self.display_mode,
            ) {
                self.disconnect();
            }
        }
    }

    fn do_update(
        client: &mut DiscordIpcClient,
        data: &ActivityData,
        last_end: &mut Option<i64>,
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
                    if let Err(_) = client.clear_activity() {
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
                    if let Some(prev) = last_end {
                        if (*prev - e).abs() < TIMESTAMP_THRESHOLD_MS {
                            return true;
                        }
                    }
                    activity = activity.timestamps(Timestamps::new().start(s).end(e));
                    *last_end = Some(e);
                    should_send = true;
                } else {
                    should_send = last_end.is_some();
                }
            }
        }

        if should_send {
            if let Err(_) = client.set_activity(activity) {
                return false;
            }
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

fn background_loop(rx: &Receiver<Msg>) {
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

pub fn init() {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut g) = SENDER.lock() {
        *g = Some(tx);
    }
    thread::spawn(move || background_loop(&rx));
    info!("Discord RPC 后台线程已启动");
}

fn send(msg: Msg) {
    if let Ok(g) = SENDER.lock()
        && let Some(tx) = g.as_ref()
    {
        let _ = tx.send(msg);
    }
}

pub fn enable() {
    send(Msg::Enable);
}
pub fn disable() {
    send(Msg::Disable);
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
    send(Msg::Timeline(p));
}
