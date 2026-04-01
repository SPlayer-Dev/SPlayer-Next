//! 批量扫描目录，提取音频元数据，通过回调推送进度和结果。
//!
//! 在后台线程中运行，避免阻塞 Node.js 事件循环。
//! 支持增量扫描：比对文件 mtime/size 跳过未变化的文件。

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use tracing::{debug, info, warn};
use walkdir::WalkDir;

use crate::metadata;

/// 支持的音频文件扩展名
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "aac", "m4a", "wma", "opus", "ape",
];

/// 每批回调的文件数
const BATCH_SIZE: usize = 20;

/// 已有文件记录，用于增量扫描比对
pub struct FileRecord {
    pub path: String,
    pub mtime: u64,
    pub size: u64,
}

/// 扫描到的曲目信息
pub struct ScannedTrack {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: f64,
    pub codec: String,
    pub sample_rate: u32,
    pub bit_rate: i64,
    pub channels: u32,
    pub bits_per_sample: u32,
    pub cover: Option<String>,
    pub file_size: u64,
    pub file_mtime: u64,
}

/// 扫描事件
#[expect(dead_code, reason = "Error variant 预留给未来扫描错误处理")]
pub enum ScanEvent {
    /// 进度：已处理一批文件
    Progress {
        scanned: u32,
        total: u32,
        current: Option<String>,
        tracks: Vec<ScannedTrack>,
    },
    /// 扫描完成
    Done {
        scanned: u32,
        total: u32,
        removed_paths: Vec<String>,
    },
    /// 扫描出错
    Error {
        scanned: u32,
        total: u32,
        error: String,
    },
}

/// 判断文件是否为音频文件
fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// 使用 lofty 快速读取音频文件元数据（纯 tag 解析，不解码音频数据，~5-20ms/文件）
fn probe_fast(path: &str, cover_cache_dir: Option<&str>) -> Option<ScannedTrack> {
    let tagged_file = lofty::read_from_path(path).ok()?;
    let properties = tagged_file.properties();
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let duration = properties.duration().as_secs_f64();
    let sample_rate = properties.sample_rate().unwrap_or(0);
    let bit_rate = properties.audio_bitrate().map_or(0, |br| br as i64 * 1000);
    let channels = properties.channels().unwrap_or(0) as u32;
    let bits_per_sample = properties.bit_depth().unwrap_or(0) as u32;

    // 从扩展名推导 codec
    let codec = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let (title, artist, album) = if let Some(tag) = tag {
        (
            tag.title().map(|s| s.to_string()),
            tag.artist().map(|s| s.to_string()),
            tag.album().map(|s| s.to_string()),
        )
    } else {
        (None, None, None)
    };

    // 封面提取：从 tag 中读取图片，生成缩略图缓存
    let cover = cover_cache_dir.and_then(|cache_dir| {
        let pic = tag?.pictures().first()?;
        let pic_data = pic.data();
        if pic_data.is_empty() {
            return None;
        }
        generate_cover_cache(path, pic_data, cache_dir)
    });

    Some(ScannedTrack {
        path: path.to_string(),
        title,
        artist,
        album,
        duration,
        codec,
        sample_rate,
        bit_rate,
        channels,
        bits_per_sample,
        cover,
        file_size: 0, // 由调用方填充
        file_mtime: 0,
    })
}

/// 生成封面缩略图缓存，返回缓存路径
fn generate_cover_cache(source: &str, pic_data: &[u8], cache_dir: &str) -> Option<String> {
    let cache_dir = Path::new(cache_dir);

    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let hash = hasher.finish();
    let thumb_file = cache_dir.join(format!("cover_{hash:016x}_thumb.jpg"));

    // 缓存命中
    if thumb_file.exists() {
        return Some(thumb_file.to_string_lossy().into_owned());
    }

    fs::create_dir_all(cache_dir).ok()?;

    // 尝试生成缩略图，失败则直接写原始数据
    if metadata::generate_cover_thumbnail(pic_data, &thumb_file).is_err() {
        fs::write(&thumb_file, pic_data).ok()?;
    }

    Some(thumb_file.to_string_lossy().into_owned())
}

/// 获取文件的 mtime（Unix 毫秒）和大小
fn file_stat(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((mtime, meta.len()))
}

/// 批量扫描目录
///
/// - `dirs`: 待扫描目录列表
/// - `cover_cache_dir`: 封面缓存目录
/// - `incremental_data`: 可选的已有文件记录，用于增量跳过
/// - `cancel`: 取消标志，外部设置为 true 后扫描会尽快停止
/// - `callback`: 回调函数，接收 ScanEvent
pub fn scan_directories(
    dirs: &[String],
    cover_cache_dir: Option<&str>,
    incremental_data: Option<&[FileRecord]>,
    cancel: &AtomicBool,
    callback: &dyn Fn(ScanEvent),
) {
    // 构建已有文件索引 path → (mtime, size)
    let existing: HashMap<&str, (u64, u64)> = incremental_data
        .map(|records| {
            records
                .iter()
                .map(|r| (r.path.as_str(), (r.mtime, r.size)))
                .collect()
        })
        .unwrap_or_default();

    // 第一遍：收集所有音频文件路径
    info!("开始收集音频文件...");
    let mut audio_files: Vec<(String, u64, u64)> = Vec::new();
    let mut scanned_paths: Vec<String> = Vec::new();

    for dir in dirs {
        if cancel.load(Ordering::Relaxed) {
            info!("扫描已取消（文件收集阶段）");
            return;
        }
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            warn!("跳过无效目录: {dir}");
            continue;
        }
        for entry in WalkDir::new(dir).follow_links(true).into_iter().flatten() {
            let path = entry.path();
            if !path.is_file() || !is_audio_file(path) {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            if let Some((mtime, size)) = file_stat(path) {
                scanned_paths.push(path_str.clone());
                // 增量比对：mtime 和 size 都未变化则跳过
                if let Some(&(old_mtime, old_size)) = existing.get(path_str.as_str()) {
                    if old_mtime == mtime && old_size == size {
                        continue;
                    }
                }
                audio_files.push((path_str, mtime, size));
            }
        }
    }

    let total = audio_files.len() as u32;
    info!(
        "收集完成: {} 个文件需要处理（共发现 {} 个音频文件）",
        total,
        scanned_paths.len()
    );

    // 第二遍：逐文件提取元数据，分批回调
    let mut scanned: u32 = 0;
    let mut batch: Vec<ScannedTrack> = Vec::with_capacity(BATCH_SIZE);

    for (path_str, mtime, size) in &audio_files {
        if cancel.load(Ordering::Relaxed) {
            info!("扫描已取消（元数据提取阶段，已处理 {scanned}/{total}）");
            callback(ScanEvent::Done {
                scanned,
                total,
                removed_paths: Vec::new(),
            });
            return;
        }

        let current_name = Path::new(path_str)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());

        match probe_fast(path_str, cover_cache_dir) {
            Some(mut track) => {
                track.file_size = *size;
                track.file_mtime = *mtime;
                batch.push(track);
            }
            None => {
                debug!("跳过文件 {path_str}: lofty 无法解析");
            }
        }

        scanned += 1;

        // 达到批次大小或最后一个文件，推送进度
        if batch.len() >= BATCH_SIZE || scanned == total {
            callback(ScanEvent::Progress {
                scanned,
                total,
                current: current_name,
                tracks: std::mem::replace(&mut batch, Vec::with_capacity(BATCH_SIZE)),
            });
        }
    }

    // 计算已删除的文件（在 existing 中但不在 scanned_paths 中）
    let scanned_set: std::collections::HashSet<&str> =
        scanned_paths.iter().map(String::as_str).collect();
    let removed_paths: Vec<String> = existing
        .keys()
        .filter(|path| !scanned_set.contains(**path))
        .map(|&path| path.to_string())
        .collect();

    if !removed_paths.is_empty() {
        info!("发现 {} 个已删除文件", removed_paths.len());
    }

    callback(ScanEvent::Done {
        scanned,
        total,
        removed_paths,
    });
}
