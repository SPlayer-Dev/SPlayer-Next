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

/// 缩略图最大边长（px）
const THUMB_SIZE: u32 = 300;

/// 支持的歌词文件扩展名
const LYRIC_EXTENSIONS: &[&str] = &["ttml", "lys", "yrc", "qrc", "lrc", "ass", "srt"];

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

    if generate_thumbnail(&data, &thumb_file).is_err() {
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

/// 将原始图片数据缩放为 JPEG 缩略图
fn generate_thumbnail(data: &[u8], output_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
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
