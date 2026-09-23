//! 从音频文件所在目录查找外部封面图片。
//!
//! 当音频文件没有内嵌封面时，回退到同目录下的常见封面文件。
//! 支持的文件名（不区分大小写）按优先级排列：
//! cover → folder → album → front → <同名> → 目录下唯一图片

use std::path::{Path, PathBuf};

/// 按优先级排列的封面文件名列表（不含扩展名）
const COVER_NAMES: &[&str] = &["cover", "folder", "album", "front"];

/// 支持的图片扩展名
const COVER_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp"];

/// 在音频文件所在目录查找封面图片。
///
/// 查找顺序：
/// 1. 固定优先名：cover / folder / album / front（+ 支持的扩展名组合）
/// 2. 与音频文件同名的图片文件
/// 3. 目录下唯一的图片文件
///
/// @param audio_path - 音频文件路径
/// @returns 找到的封面图片路径，未找到返回 None
pub fn find_folder_cover(audio_path: &str) -> Option<PathBuf> {
    let audio = Path::new(audio_path);
    let dir = audio.parent()?;

    let entries = list_dir_images(dir)?;

    // 按优先名匹配
    for name in COVER_NAMES {
        for ext in COVER_EXTS {
            let target = format!("{name}.{ext}");
            if let Some(path) = find_case_insensitive(&entries, &target) {
                return Some(path);
            }
        }
    }

    // 与音频同名的图片
    let stem = audio.file_stem()?.to_str()?;
    for ext in COVER_EXTS {
        let target = format!("{stem}.{ext}");
        if let Some(path) = find_case_insensitive(&entries, &target) {
            return Some(path);
        }
    }

    // 目录下唯一的图片文件
    if entries.len() == 1 {
        return Some(entries.into_iter().next().unwrap());
    }

    None
}

/// 列出目录下所有支持扩展名的图片文件
fn list_dir_images(dir: &Path) -> Option<Vec<PathBuf>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut images = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // 无扩展名的文件直接跳过，不影响其他文件的扫描
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if COVER_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            images.push(path);
        }
    }
    Some(images)
}

/// 大小写不敏感匹配文件名
fn find_case_insensitive(entries: &[PathBuf], target: &str) -> Option<PathBuf> {
    let target_lower = target.to_ascii_lowercase();
    entries
        .iter()
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.to_ascii_lowercase() == target_lower)
        })
        .cloned()
}

#[cfg(test)]
#[path = "tests/folder_cover.rs"]
mod tests;
