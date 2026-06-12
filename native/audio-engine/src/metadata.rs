use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;

use ffmpeg_audio::{AudioReader, SourceAudioInfo};

/// 一条外部歌词（仅格式和路径，内容按需加载）
#[derive(Clone)]
pub struct ExternalLyric {
    pub format: String,
    pub path: String,
}

/// 音频流基本参数（scanner 和 decoder 共用）
pub struct StreamInfo {
    pub bit_rate: i64,
    pub sample_rate: u32,
    pub bits_per_sample: u32,
    pub channels: u32,
}

/// 容器级别的 tag 信息
pub struct Tags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub comment: Option<String>,
}

/// 缩略图最大边长（px）
const THUMB_SIZE: u32 = 300;

/// 支持的歌词文件扩展名
const LYRIC_EXTENSIONS: &[&str] = &["ttml", "lys", "qrc", "krc", "yrc", "lrc", "ass", "srt"];

/// 把 ffmpeg_audio 的 SourceAudioInfo 转成内部 StreamInfo
pub fn extract_stream_info(info: &SourceAudioInfo) -> StreamInfo {
    StreamInfo {
        bit_rate: info.bit_rate,
        sample_rate: info.sample_rate.max(0) as u32,
        bits_per_sample: info.bits_per_sample.max(0) as u32,
        channels: info.channels.max(0) as u32,
    }
}

/// 大小写不敏感查找：原 ffmpeg-next 的 Dictionary::get 默认 case-insensitive，
/// 而 ffmpeg_audio 把 dict 转成普通 HashMap 后丢了这个语义，这里补回来
fn dict_get<'a>(dict: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    dict.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

/// 从容器 metadata 提取常见 tag
pub fn extract_tags(dict: &HashMap<String, String>) -> Tags {
    let title = dict_get(dict, "title").map(ToString::to_string);
    let artist = dict_get(dict, "artist")
        .or_else(|| dict_get(dict, "album_artist"))
        .map(ToString::to_string);
    let album = dict_get(dict, "album").map(ToString::to_string);
    let comment = dict_get(dict, "comment").map(ToString::to_string);
    Tags {
        title,
        artist,
        album,
        comment,
    }
}

/// 从容器 metadata 提取 ReplayGain / R128 增益值（dB）
///
/// 按优先级尝试：R128_TRACK_GAIN → replaygain_track_gain → album 版本
pub fn extract_replay_gain(dict: &HashMap<String, String>) -> Option<f32> {
    // EBU R128：值为 1/256 dB 单位的整数
    if let Some(val) =
        dict_get(dict, "R128_TRACK_GAIN").or_else(|| dict_get(dict, "R128_ALBUM_GAIN"))
    {
        if let Ok(raw) = val.trim().parse::<f32>() {
            return Some(raw / 256.0);
        }
    }

    // ReplayGain：格式如 "-6.50 dB"
    if let Some(val) =
        dict_get(dict, "replaygain_track_gain").or_else(|| dict_get(dict, "replaygain_album_gain"))
    {
        let cleaned = val.trim().trim_end_matches(" dB").trim_end_matches("dB");
        if let Ok(db) = cleaned.parse::<f32>() {
            return Some(db);
        }
    }

    None
}

/// 将 dB 增益转换为线性增益因子
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// 计算源文件对应的封面缩略图缓存路径（按源路径哈希命名）
pub fn cover_thumb_path(source: &str, cache_dir: &str) -> std::path::PathBuf {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let hash = hasher.finish();
    Path::new(cache_dir).join(format!("cover_{hash:016x}_thumb.jpg"))
}

/// 从 reader 中提取封面缩略图，写入缓存目录，返回缩略图路径
pub fn extract_cover_thumbnail(
    reader: &AudioReader,
    source: &str,
    cache_dir: &str,
) -> Option<String> {
    let thumb_file = cover_thumb_path(source, cache_dir);

    if thumb_file.exists() {
        return Some(thumb_file.to_string_lossy().into_owned());
    }

    let cover = reader.cover()?;
    std::fs::create_dir_all(cache_dir).ok()?;

    if generate_cover_thumbnail(&cover.data, &thumb_file).is_err() {
        // 缩略图生成失败，直接写入原始数据作为回退
        std::fs::write(&thumb_file, &cover.data).ok()?;
    }

    Some(thumb_file.to_string_lossy().into_owned())
}

/// 拿原始封面字节（供 SMTC / 全屏播放器使用，不缓存）
pub fn read_attached_pic(reader: &AudioReader) -> Option<Vec<u8>> {
    reader.cover().map(|c| c.data)
}

/// 将任意图片字节缩放为 JPEG 缩略图字节（内存内，不落盘）。
/// 用于选图预览：原生层缩好再交给渲染层，避免渲染层把整图解码成位图占内存
pub fn make_thumbnail_jpeg(data: &[u8], max_size: u32) -> anyhow::Result<Vec<u8>> {
    let img = image::load_from_memory(data)?;
    let thumb = img.thumbnail(max_size, max_size);
    let mut out = Vec::new();
    thumb.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Jpeg)?;
    Ok(out)
}

/// 将原始图片数据缩放为 JPEG 缩略图
pub fn generate_cover_thumbnail(
    data: &[u8],
    output_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let img = image::load_from_memory(data)?;
    let thumb = img.thumbnail(THUMB_SIZE, THUMB_SIZE);
    thumb.save_with_format(output_path, image::ImageFormat::Jpeg)?;
    Ok(())
}

/// 从容器 metadata 提取内嵌歌词
pub fn extract_embedded_lyric(dict: &HashMap<String, String>) -> Option<String> {
    dict_get(dict, "lyrics")
        .or_else(|| dict_get(dict, "UNSYNCEDLYRICS"))
        .map(ToString::to_string)
        .filter(|s| !s.is_empty())
}

/// 查找同目录下的所有歌词文件
pub fn find_all_external_lyrics(source: &str) -> Vec<ExternalLyric> {
    let source_path = Path::new(source);
    let mut lyrics = Vec::new();

    for ext in LYRIC_EXTENSIONS {
        let lyric_path = source_path.with_extension(ext);
        if lyric_path.exists() {
            lyrics.push(ExternalLyric {
                format: (*ext).to_string(),
                path: lyric_path.to_string_lossy().into_owned(),
            });
        }
    }

    lyrics
}
