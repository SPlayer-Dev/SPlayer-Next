use std::fmt;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaEventType {
    Play,
    Pause,
    Stop,
    NextTrack,
    PrevTrack,
    ToggleShuffle,
    ToggleRepeat,
    SetRate,
    SetVolume,
    /// 绝对位置（毫秒）
    Seek,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct MediaEvent {
    pub type_: MediaEventType,
    pub position_ms: Option<f64>,
    pub rate: Option<f64>,
    pub volume: Option<f64>,
}

impl MediaEvent {
    pub const fn new(t: MediaEventType) -> Self {
        Self {
            type_: t,
            position_ms: None,
            rate: None,
            volume: None,
        }
    }
    pub const fn seek(pos: f64) -> Self {
        Self {
            type_: MediaEventType::Seek,
            position_ms: Some(pos),
            rate: None,
            volume: None,
        }
    }
    pub const fn set_rate(rate: f64) -> Self {
        Self {
            type_: MediaEventType::SetRate,
            position_ms: None,
            rate: Some(rate),
            volume: None,
        }
    }
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub const fn set_volume(volume: f64) -> Self {
        Self {
            type_: MediaEventType::SetVolume,
            position_ms: None,
            rate: None,
            volume: Some(volume),
        }
    }
}

/// 多歌手拼接分隔符（与前端 formatArtists 保持一致）
const ARTIST_SEPARATOR: &str = " / ";

/// 内部使用的元数据（cover_data 已转为 Vec<u8>）
#[derive(Clone, PartialEq)]
pub struct MetadataPayload {
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub cover_data: Option<Vec<u8>>,
    pub cover_url: Option<String>,
    pub duration_ms: Option<f64>,
}

impl MetadataPayload {
    /// 拼接后的歌手文本，供只接受单一字符串的平台（SMTC / MPNowPlaying / Discord）使用
    pub fn artist_text(&self) -> String {
        self.artists.join(ARTIST_SEPARATOR)
    }
}

impl fmt::Debug for MetadataPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MetadataPayload")
            .field("title", &self.title)
            .field("artists", &self.artists)
            .field("album", &self.album)
            .field(
                "cover_data",
                &self.cover_data.as_ref().map_or_else(
                    || "None".to_string(),
                    |bytes| format!("Some({} bytes)", bytes.len()),
                ),
            )
            .field("cover_url", &self.cover_url)
            .field("duration_ms", &self.duration_ms)
            .finish()
    }
}

/// NAPI 层接收的元数据参数
#[napi(object)]
pub struct MetadataParam {
    pub title: String,
    /// 歌手列表（MPRIS 需要多值，其余平台内部拼接）
    pub artists: Vec<String>,
    pub album: String,
    /// 封面原始字节（用于系统媒体控件）
    pub cover_data: Option<Buffer>,
    /// 封面 HTTP URL（用于 Discord RPC，Linux 无 cover_data 时也可用）
    pub cover_url: Option<String>,
    /// 时长（毫秒）
    pub duration_ms: Option<f64>,
}

impl From<MetadataParam> for MetadataPayload {
    fn from(p: MetadataParam) -> Self {
        Self {
            title: p.title,
            artists: p.artists,
            album: p.album,
            cover_data: p.cover_data.map(|b| b.to_vec()),
            cover_url: p.cover_url,
            duration_ms: p.duration_ms,
        }
    }
}

#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackStatus {
    Playing,
    Paused,
}

#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepeatMode {
    None,
    Track,
    List,
}

#[napi(object)]
#[derive(Debug, Clone, Copy)]
pub struct PlayStateParam {
    pub status: PlaybackStatus,
}

#[napi(object)]
#[derive(Debug, Clone, Copy)]
pub struct TimelineParam {
    /// 当前位置（毫秒）
    pub current_ms: f64,
    /// 总时长（毫秒）
    pub total_ms: f64,
    /// 是否为 seek 操作触发
    #[napi(js_name = "seeked")]
    pub seeked: Option<bool>,
}

#[napi(object)]
#[derive(Debug, Clone, Copy)]
pub struct PlayModeParam {
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

/// Discord 显示模式
#[napi(string_enum)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscordDisplayMode {
    /// Listening to SPlayer
    Name,
    /// Listening to {artist}
    State,
    /// Listening to {title}
    Details,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct DiscordConfig {
    pub show_when_paused: bool,
    pub display_mode: Option<DiscordDisplayMode>,
}
