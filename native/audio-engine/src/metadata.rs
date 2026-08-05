use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

use ffmpeg_audio::{AudioReader, SourceAudioInfo};
use sha2::{Digest, Sha256};

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
    pub track: Option<u16>,
    pub comment: Option<String>,
}

/// 缩略图最大边长（px）
const THUMB_SIZE: u32 = 300;
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 100_000_000;
const MAX_COVER_CACHE_FILES: usize = 5_000;
const MAX_COVER_CACHE_BYTES: u64 = 1024 * 1024 * 1024;
const COVER_CACHE_CLEANUP_INTERVAL: u64 = 128;
static COVER_TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static COVER_WRITE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

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

/// 从容器 metadata 提取常见 tag
pub fn extract_tags(dict: &HashMap<String, String>) -> Tags {
    let title = dict_get(dict, "title").map(ToString::to_string);
    let artist = dict_get(dict, "artist")
        .or_else(|| dict_get(dict, "album_artist"))
        .map(ToString::to_string);
    let album = dict_get(dict, "album").map(ToString::to_string);
    let track = dict_get(dict, "track").and_then(|s| s.parse().ok());
    let comment = dict_get(dict, "comment").map(ToString::to_string);
    Tags {
        title,
        artist,
        album,
        track,
        comment,
    }
}

/// 大小写不敏感查找：原 ffmpeg-next 的 Dictionary::get 默认 case-insensitive，
/// 而 ffmpeg_audio 把 dict 转成普通 HashMap 后丢了这个语义，这里补回来
fn dict_get<'a>(dict: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    let target = crate::normalize_tag_key(key);
    dict.iter()
        .find(|(k, _)| crate::normalize_tag_key(k) == target)
        .map(|(_, v)| v.as_str())
}

/// 从容器 metadata 提取内嵌歌词（兼容 LYRICS、UNSYNCED LYRICS、SYNCED LYRICS、USLT、SYLT 等标签，支持各类语言代码后缀如 -ENG）
pub fn extract_embedded_lyric(dict: &HashMap<String, String>) -> Option<String> {
    dict.iter()
        .filter(|(k, v)| !v.is_empty() && crate::is_lyric_field_key(&crate::normalize_tag_key(k)))
        .max_by_key(|(k, _)| crate::get_lyric_priority(&crate::normalize_tag_key(k)))
        .map(|(_, v)| v.to_string())
}

/// 从容器 metadata 提取 ReplayGain / R128 增益值（dB）
///
/// 按优先级尝试：R128_TRACK_GAIN → replaygain_track_gain → album 版本
pub fn extract_replay_gain(dict: &HashMap<String, String>) -> Option<f32> {
    // EBU R128：值为 1/256 dB 单位的整数
    if let Some(val) =
        dict_get(dict, "R128_TRACK_GAIN").or_else(|| dict_get(dict, "R128_ALBUM_GAIN"))
        && let Ok(raw) = val.trim().parse::<f32>()
    {
        return Some(raw / 256.0);
    }

    // ReplayGain：格式如 "-6.50 dB"
    if let Some(val) =
        dict_get(dict, "replaygain_track_gain").or_else(|| dict_get(dict, "replaygain_album_gain"))
        && let Ok(db) = val
            .trim()
            .trim_end_matches(" dB")
            .trim_end_matches("dB")
            .parse::<f32>()
    {
        return Some(db);
    }

    None
}

/// 将 dB 增益转换为线性增益因子
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// 计算源文件对应的封面缩略图缓存路径。
///
/// SHA-256 是稳定的持久化 key；不会把签名 URL 的 query 原样暴露到文件名中。
pub fn cover_thumb_path(source: &str, cache_dir: &str) -> std::path::PathBuf {
    let mut hasher = Sha256::new();
    if let Ok(mut url) = url::Url::parse(source)
        && matches!(url.scheme(), "http" | "https")
    {
        url.set_query(None);
        url.set_fragment(None);
        hasher.update(url.as_str().as_bytes());
    } else {
        let canonical = std::fs::canonicalize(source).ok();
        let identity = canonical
            .as_deref()
            .unwrap_or_else(|| Path::new(source))
            .to_string_lossy();
        hasher.update(identity.as_bytes());
        if let Ok(metadata) = std::fs::metadata(source) {
            hasher.update(metadata.len().to_le_bytes());
            if let Ok(modified) = metadata.modified()
                && let Ok(duration) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH)
            {
                hasher.update(duration.as_nanos().to_le_bytes());
            }
        }
    }
    let digest = hasher.finalize();
    Path::new(cache_dir).join(format!("cover_{digest:x}_thumb.jpg"))
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
    cache_cover_thumbnail(&cover.data, source, cache_dir)
}

/// 将已读取的 attached picture 写入缩略图缓存，避免同一 reader 重复提取封面。
pub fn cache_cover_thumbnail(data: &[u8], source: &str, cache_dir: &str) -> Option<String> {
    let thumb_file = cover_thumb_path(source, cache_dir);
    if thumb_file.exists() {
        return Some(thumb_file.to_string_lossy().into_owned());
    }
    std::fs::create_dir_all(cache_dir).ok()?;

    let temp = thumb_file.with_extension(format!(
        "jpg.tmp.{}.{}",
        std::process::id(),
        COVER_TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    if generate_cover_thumbnail(data, &temp).is_err() {
        let _ = std::fs::remove_file(&temp);
        return None;
    }
    if atomic_replace_cover(&temp, &thumb_file).is_err() {
        let _ = std::fs::remove_file(&temp);
        return if thumb_file.exists() {
            Some(thumb_file.to_string_lossy().into_owned())
        } else {
            None
        };
    }

    if COVER_WRITE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        % COVER_CACHE_CLEANUP_INTERVAL
        == 0
    {
        cleanup_cover_cache(Path::new(cache_dir));
    }

    Some(thumb_file.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
fn atomic_replace_cover(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    use windows::core::PCWSTR;

    let temp = temp
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: UTF-16 缓冲均以 NUL 结尾并在调用期间有效，flags 要求替换和落盘。
    unsafe {
        MoveFileExW(
            PCWSTR(temp.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(std::io::Error::other)
}

#[cfg(unix)]
fn atomic_replace_cover(temp: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(temp, target)?;
    if let Some(parent) = target.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", unix)))]
fn atomic_replace_cover(temp: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(temp, target)
}

fn cleanup_cover_cache(cache_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then(|| {
                (
                    entry.path(),
                    metadata
                        .modified()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                    metadata.len(),
                )
            })
        })
        .collect::<Vec<_>>();
    let mut total_bytes = files.iter().map(|(_, _, size)| *size).sum::<u64>();
    if files.len() <= MAX_COVER_CACHE_FILES && total_bytes <= MAX_COVER_CACHE_BYTES {
        return;
    }
    files.sort_unstable_by_key(|(_, modified, _)| *modified);
    let mut remaining = files.len();
    for (path, _, size) in files {
        if remaining <= MAX_COVER_CACHE_FILES && total_bytes <= MAX_COVER_CACHE_BYTES {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            remaining -= 1;
            total_bytes = total_bytes.saturating_sub(size);
        }
    }
}

/// 将任意图片字节缩放为 JPEG 缩略图字节（内存内，不落盘）。
/// 用于选图预览：原生层缩好再交给渲染层，避免渲染层把整图解码成位图占内存
pub fn make_thumbnail_jpeg(data: &[u8], max_size: u32) -> anyhow::Result<Vec<u8>> {
    anyhow::ensure!(
        !data.is_empty() && data.len() <= MAX_IMAGE_BYTES,
        "图片数据过大或为空"
    );
    anyhow::ensure!(max_size > 0 && max_size <= 4096, "缩略图尺寸无效");
    let reader = image::ImageReader::new(Cursor::new(data)).with_guessed_format()?;
    let (width, height) = reader.into_dimensions()?;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| anyhow::anyhow!("图片尺寸溢出"))?;
    anyhow::ensure!(pixels <= MAX_IMAGE_PIXELS, "图片像素数过大");
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
    let encoded = make_thumbnail_jpeg(data, THUMB_SIZE)?;
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    std::fs::write(output_path, encoded)?;
    let file = std::fs::OpenOptions::new().read(true).open(output_path)?;
    file.sync_all()?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn thumbnail_rejects_empty_and_invalid_size() {
        assert!(make_thumbnail_jpeg(&[], 300).is_err());
        assert!(make_thumbnail_jpeg(&[1, 2, 3], 0).is_err());
        assert!(make_thumbnail_jpeg(&[1, 2, 3], 4097).is_err());
    }

    #[test]
    fn thumbnail_output_is_a_real_jpeg() {
        let image = ImageBuffer::from_pixel(2, 2, Rgb([255, 0, 0]));
        let mut source = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut Cursor::new(&mut source), image::ImageFormat::Png)
            .expect("生成测试图片失败");

        let thumbnail = make_thumbnail_jpeg(&source, 300).expect("生成缩略图失败");
        assert_eq!(&thumbnail[..2], &[0xff, 0xd8]);
        assert_eq!(&thumbnail[thumbnail.len() - 2..], &[0xff, 0xd9]);
    }

    #[test]
    fn signed_remote_cover_query_does_not_change_cache_identity() {
        let first = cover_thumb_path(
            "https://music.example/cover/42.jpg?token=first#fragment",
            "cache",
        );
        let second = cover_thumb_path("https://music.example/cover/42.jpg?token=second", "cache");
        assert_eq!(first, second);
    }

    #[test]
    fn local_cover_identity_changes_when_source_file_changes() {
        let dir = std::env::temp_dir().join(format!(
            "splayer-cover-key-{}-{}",
            std::process::id(),
            COVER_TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("track.flac");
        std::fs::write(&source, b"one").unwrap();
        let first = cover_thumb_path(&source.to_string_lossy(), &dir.to_string_lossy());
        std::fs::write(&source, b"longer-content").unwrap();
        let second = cover_thumb_path(&source.to_string_lossy(), &dir.to_string_lossy());
        assert_ne!(first, second);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
