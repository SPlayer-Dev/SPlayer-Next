use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use ffmpeg_next as ffmpeg;

/// 一条外部歌词（仅格式和路径，内容按需加载）
#[derive(Clone)]
pub struct ExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc"）
    pub format: String,
    /// 文件路径
    pub path: String,
}

/// 音频流基本参数（scanner 和 decoder 共用）
pub struct StreamInfo {
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 原始采样率（Hz）
    pub sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 声道数
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

/// 从音频流参数中提取比特率、原始采样率和位深
///
/// # Safety
/// `stream` 和 `input_ctx` 的底层指针必须有效（由调用方保证生命周期）
pub unsafe fn extract_stream_info(
    stream: &ffmpeg::Stream,
    input_ctx: &ffmpeg::format::context::Input,
) -> StreamInfo {
    let params = stream.parameters().as_ptr();
    let stream_bit_rate = (*params).bit_rate;
    // FLAC 等无损格式的 stream bit_rate 通常为 0，fallback 到容器级别
    let bit_rate = if stream_bit_rate > 0 {
        stream_bit_rate
    } else {
        (*input_ctx.as_ptr()).bit_rate
    };
    let sample_rate = (*params).sample_rate as u32;
    let bits_per_raw = (*params).bits_per_raw_sample as u32;
    let bits_per_coded = (*params).bits_per_coded_sample as u32;
    let bits_per_sample = if bits_per_raw > 0 {
        bits_per_raw
    } else {
        bits_per_coded
    };
    let channels = (*params).ch_layout.nb_channels.max(0) as u32;
    StreamInfo {
        bit_rate,
        sample_rate,
        bits_per_sample,
        channels,
    }
}

/// 从容器 metadata 提取常见 tag
pub fn extract_tags(input_ctx: &ffmpeg::format::context::Input) -> Tags {
    let dict = input_ctx.metadata();
    let title = dict.get("title").map(ToString::to_string);
    let artist = dict
        .get("artist")
        .or_else(|| dict.get("album_artist"))
        .map(ToString::to_string);
    let album = dict.get("album").map(ToString::to_string);
    let comment = dict.get("comment").map(ToString::to_string);
    Tags {
        title,
        artist,
        album,
        comment,
    }
}

/// 从容器 metadata 提取 ReplayGain / R128 增益值（dB）
///
/// 按优先级尝试：R128_TRACK_GAIN → replaygain_track_gain → replaygain_album_gain
pub fn extract_replay_gain(input_ctx: &ffmpeg::format::context::Input) -> Option<f32> {
    let dict = input_ctx.metadata();

    // EBU R128：值为 1/256 dB 单位的整数
    if let Some(val) = dict.get("R128_TRACK_GAIN").or_else(|| dict.get("R128_ALBUM_GAIN")) {
        if let Ok(raw) = val.trim().parse::<f32>() {
            return Some(raw / 256.0);
        }
    }

    // ReplayGain：格式如 "-6.50 dB"
    if let Some(val) = dict
        .get("replaygain_track_gain")
        .or_else(|| dict.get("REPLAYGAIN_TRACK_GAIN"))
        .or_else(|| dict.get("replaygain_album_gain"))
        .or_else(|| dict.get("REPLAYGAIN_ALBUM_GAIN"))
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

/// 从已打开的 input_ctx 中提取封面缩略图，写入缓存目录，返回缩略图路径。
///
/// 只缓存 300x300 JPEG 缩略图供前端日常显示，原图不落盘。
/// 高清封面在 `start_decode` 中通过 `read_attached_pic` 一并提取并缓存于 InnerPlayer。
pub fn extract_cover_thumbnail(
    input_ctx: &ffmpeg::format::context::Input,
    source: &str,
    cache_dir: &str,
) -> Option<String> {
    let cache_dir = Path::new(cache_dir);

    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let hash = hasher.finish();

    let thumb_file = cache_dir.join(format!("cover_{hash:016x}_thumb.jpg"));

    // 缓存命中
    if thumb_file.exists() {
        return Some(thumb_file.to_string_lossy().into_owned());
    }

    let data = read_attached_pic(input_ctx)?;

    std::fs::create_dir_all(cache_dir).ok()?;

    if generate_cover_thumbnail(&data, &thumb_file).is_err() {
        // 缩略图生成失败，直接写入原始数据作为回退
        std::fs::write(&thumb_file, &data).ok()?;
    }

    Some(thumb_file.to_string_lossy().into_owned())
}

/// 从 input_ctx 的 attached_pic 流读取原始封面字节
pub fn read_attached_pic(input_ctx: &ffmpeg::format::context::Input) -> Option<Vec<u8>> {
    for stream in input_ctx.streams() {
        if stream
            .disposition()
            .contains(ffmpeg::format::stream::Disposition::ATTACHED_PIC)
        {
            // SAFETY: stream.as_ptr() 返回有效的 AVStream 指针，attached_pic 字段
            // 在 ATTACHED_PIC disposition 下由 FFmpeg 保证初始化且生命周期与 input_ctx 一致
            unsafe {
                let raw_stream = stream.as_ptr();
                let pkt = &(*raw_stream).attached_pic;
                if pkt.size > 0 && !pkt.data.is_null() {
                    let data = std::slice::from_raw_parts(pkt.data.cast_const(), pkt.size as usize);
                    return Some(data.to_vec());
                }
            }
        }
    }
    None
}

/// 将原始图片数据缩放为 JPEG 缩略图（供 scanner 和 extract_cover_thumbnail 共用）
pub fn generate_cover_thumbnail(data: &[u8], output_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let img = image::load_from_memory(data)?;
    let thumb = img.thumbnail(THUMB_SIZE, THUMB_SIZE);
    thumb.save_with_format(output_path, image::ImageFormat::Jpeg)?;
    Ok(())
}

/// 从已打开的 input_ctx 中读取内嵌歌词
pub fn extract_embedded_lyric(input_ctx: &ffmpeg::format::context::Input) -> Option<String> {
    let dict = input_ctx.metadata();
    dict.get("lyrics")
        .or_else(|| dict.get("LYRICS"))
        .or_else(|| dict.get("UNSYNCEDLYRICS"))
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
