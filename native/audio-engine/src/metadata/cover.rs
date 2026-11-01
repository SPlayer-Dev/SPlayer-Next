use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;

use ffmpeg_audio::AudioReader;

use super::folder_cover::find_folder_cover;

/// 缩略图最大边长（px）
const THUMB_SIZE: u32 = 300;

/// 计算源文件对应的封面缩略图缓存路径（按源路径哈希命名）
pub fn cover_thumb_path(source: &str, cache_dir: &str) -> std::path::PathBuf {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let hash = hasher.finish();
    Path::new(cache_dir).join(format!("cover_{hash:016x}_thumb.jpg"))
}

/// 从 reader 中提取封面缩略图，写入缓存目录，返回缩略图路径。
/// 当音频文件无内嵌封面时，回退到同目录下的封面图片文件。
///
/// @param reader - 音频读取器
/// @param source - 音频文件路径
/// @param cache_dir - 缩略图缓存目录
pub fn extract_cover_thumbnail(
    reader: &AudioReader,
    source: &str,
    cache_dir: &str,
) -> Option<String> {
    let thumb_file = cover_thumb_path(source, cache_dir);

    if thumb_file.exists() {
        return Some(thumb_file.to_string_lossy().into_owned());
    }

    // 内嵌封面优先，无则回退同目录封面图片
    let data = reader
        .cover()
        .map(|cover| cover.data)
        .or_else(|| find_folder_cover(source).and_then(|p| std::fs::read(p).ok()))?;
    std::fs::create_dir_all(cache_dir).ok()?;
    generate_cover_thumbnail(&data, &thumb_file).ok()?;

    Some(thumb_file.to_string_lossy().into_owned())
}

/// 拿原始封面字节（供 SMTC / 全屏播放器使用，不缓存）
pub fn read_attached_pic(reader: &AudioReader) -> Option<Vec<u8>> {
    reader.cover().map(|cover| cover.data)
}

/// 将任意图片字节缩放为 JPEG 缩略图字节（内存内，不落盘）。
/// 用于选图预览：原生层缩好再交给渲染层，避免渲染层把整图解码成位图占内存
pub fn make_thumbnail_jpeg(data: &[u8], max_size: u32) -> anyhow::Result<Vec<u8>> {
    let image = image::load_from_memory(data)?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let mut output = Vec::new();
    thumbnail.write_to(&mut Cursor::new(&mut output), image::ImageFormat::Jpeg)?;
    Ok(output)
}

/// 将原始图片数据缩放为 JPEG 缩略图
fn generate_cover_thumbnail(
    data: &[u8],
    output_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let image = image::load_from_memory(data)?;
    let thumbnail = image.thumbnail(THUMB_SIZE, THUMB_SIZE);
    thumbnail.save_with_format(output_path, image::ImageFormat::Jpeg)?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/cover.rs"]
mod tests;
