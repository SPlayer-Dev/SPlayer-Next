use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use ffmpeg_next as ffmpeg;

/// 一条外部歌词
#[derive(Clone)]
pub struct ExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc"）
    pub format: String,
    /// 歌词内容
    pub content: String,
}

/// 支持的歌词文件扩展名
const LYRIC_EXTENSIONS: &[&str] = &["ttml", "lys", "yrc", "qrc", "eslrc", "lrc"];

/// 从已打开的 input_ctx 中提取封面图片，写入缓存目录，返回文件路径。
///
/// 使用 `attached_pic` 直接读取（FFmpeg 打开文件时已预加载），
/// 不需要迭代 packets，不影响后续解码。
pub fn extract_cover(
    input_ctx: &ffmpeg::format::context::Input,
    source: &str,
    cache_dir: &str,
) -> Option<String> {
    let cache_dir = Path::new(cache_dir);

    // 文件路径 hash 作为缓存文件名
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let hash = hasher.finish();

    for stream in input_ctx.streams() {
        if stream
            .disposition()
            .contains(ffmpeg::format::stream::Disposition::ATTACHED_PIC)
        {
            let ext = match ffmpeg::codec::decoder::find(stream.parameters().id()) {
                Some(d) => match d.name() {
                    "mjpeg" | "jpeg" => "jpg",
                    "png" => "png",
                    "bmp" => "bmp",
                    "webp" => "webp",
                    _ => "jpg",
                },
                None => "jpg",
            };

            let cover_file = cache_dir.join(format!("cover_{hash:016x}.{ext}"));

            // 缓存命中
            if cover_file.exists() {
                return Some(cover_file.to_string_lossy().into_owned());
            }

            // 从 attached_pic 读取封面数据（FFmpeg 打开时已加载到内存，无需遍历 packets）
            unsafe {
                let raw_stream = stream.as_ptr();
                let pkt = &(*raw_stream).attached_pic;
                if pkt.size > 0 && !pkt.data.is_null() {
                    let data =
                        std::slice::from_raw_parts(pkt.data as *const u8, pkt.size as usize);

                    if std::fs::create_dir_all(cache_dir).is_err() {
                        return None;
                    }
                    if std::fs::write(&cover_file, data).is_ok() {
                        return Some(cover_file.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }

    None
}

/// 从已打开的 input_ctx 中读取内嵌歌词
pub fn extract_embedded_lyric(input_ctx: &ffmpeg::format::context::Input) -> Option<String> {
    let dict = input_ctx.metadata();
    dict.get("lyrics")
        .or_else(|| dict.get("LYRICS"))
        .or_else(|| dict.get("UNSYNCEDLYRICS"))
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// 查找同目录下的所有歌词文件
pub fn find_all_external_lyrics(source: &str) -> Vec<ExternalLyric> {
    let source_path = Path::new(source);
    let mut lyrics = Vec::new();

    for ext in LYRIC_EXTENSIONS {
        let lyric_path = source_path.with_extension(ext);
        if lyric_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&lyric_path) {
                if !content.is_empty() {
                    lyrics.push(ExternalLyric {
                        format: ext.to_string(),
                        content,
                    });
                }
            }
        }
    }

    lyrics
}
