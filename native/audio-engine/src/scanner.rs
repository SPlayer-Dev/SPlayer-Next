//! 批量扫描目录，提取音频元数据，通过回调推送进度和结果。
//!
//! 在后台线程中运行，避免阻塞 Node.js 事件循环。
//! 支持增量扫描：比对文件 mtime/size 跳过未变化的文件。
//! 使用 FFmpeg 提取元数据，无需额外依赖 lofty。

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime};

use ffmpeg_audio::AudioReader;
use tracing::{debug, info, warn};
use walkdir::WalkDir;

use crate::decoder;
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
    pub mtime: u64,
    pub ctime: u64,
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

/// 使用 ffmpeg_audio 打开音频文件并读取元数据
///
/// 会顺带初始化解码器和重采样器（一次性开销），扫库速度仍能跑到几百文件/秒
fn probe_fast(path: &str, cover_cache_dir: Option<&str>) -> Option<ScannedTrack> {
    let file = fs::File::open(path).ok()?;
    let reader = AudioReader::new(
        file,
        decoder::TARGET_SAMPLE_RATE as i32,
        decoder::TARGET_CHANNELS as i32,
    )
    .ok()?;

    let duration = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);

    let info = reader.source_info();
    let stream_info = metadata::extract_stream_info(info);
    let mut codec = info.codec_name.clone();

    // codec 兜底：从扩展名推导
    if codec.is_empty() {
        codec = Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
    }

    let raw_metadata = reader.metadata();
    let tags = metadata::extract_tags(&raw_metadata);

    let cover =
        cover_cache_dir.and_then(|dir| metadata::extract_cover_thumbnail(&reader, path, dir));

    Some(ScannedTrack {
        path: path.to_string(),
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        duration,
        codec,
        sample_rate: stream_info.sample_rate,
        bit_rate: stream_info.bit_rate,
        channels: stream_info.channels,
        bits_per_sample: stream_info.bits_per_sample,
        cover,
        file_size: 0, // 由调用方填充
        mtime: 0,
        ctime: 0,
    })
}

/// 获取文件时间与大小：
/// - mtime: 修改时间（Unix ms）
/// - ctime: 创建时间（Unix ms，若不可用回退为 mtime）
fn file_stat(path: &Path) -> Option<(u64, u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    let ctime = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(mtime);
    Some((mtime, ctime, meta.len()))
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
    let scan_start = Instant::now();
    info!("开始扫描，目录数: {}", dirs.len());

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
    let walk_start = Instant::now();
    let mut audio_files: Vec<(String, u64, u64, u64)> = Vec::new();
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
            if let Some((mtime, ctime, size)) = file_stat(path) {
                scanned_paths.push(path_str.clone());
                // 增量比对：mtime 和 size 都未变化则跳过
                if let Some(&(old_mtime, old_size)) = existing.get(path_str.as_str()) {
                    if old_mtime == mtime && old_size == size {
                        continue;
                    }
                }
                audio_files.push((path_str, mtime, ctime, size));
            }
        }
    }

    let total = audio_files.len() as u32;
    let walk_elapsed = walk_start.elapsed();
    info!(
        "目录遍历完成: 发现 {} 个音频文件，其中 {} 个需要处理，耗时 {:.2?}",
        scanned_paths.len(),
        total,
        walk_elapsed,
    );

    // 第二遍：逐文件提取元数据，分批回调
    let parse_start = Instant::now();
    let mut scanned: u32 = 0;
    let mut batch: Vec<ScannedTrack> = Vec::with_capacity(BATCH_SIZE);

    for (path_str, mtime, ctime, size) in &audio_files {
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
                track.mtime = *mtime;
                track.ctime = *ctime;
                batch.push(track);
            }
            None => {
                debug!("跳过文件 {path_str}: FFmpeg 无法解析");
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

    let parse_elapsed = parse_start.elapsed();
    let total_elapsed = scan_start.elapsed();
    let throughput = if parse_elapsed.as_secs_f64() > 0.0 {
        scanned as f64 / parse_elapsed.as_secs_f64()
    } else {
        0.0
    };
    info!(
        "扫描完成: 处理 {}/{} 个文件，目录遍历 {:.2?}，元数据解析 {:.2?}，总计 {:.2?}（{:.0} 文件/秒）",
        scanned,
        scanned_paths.len(),
        walk_elapsed,
        parse_elapsed,
        total_elapsed,
        throughput,
    );

    callback(ScanEvent::Done {
        scanned,
        total,
        removed_paths,
    });
}
