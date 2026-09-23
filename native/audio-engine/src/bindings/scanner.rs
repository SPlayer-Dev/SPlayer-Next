use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::info;

use crate::scanner;

/// 全局扫描取消标志
static SCAN_CANCEL: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// 已有文件记录，用于增量扫描比对
#[napi(object)]
pub struct FileRecord {
    pub path: String,
    pub mtime: f64,
    pub size: f64,
}

/// 扫描到的曲目信息
#[napi(object)]
pub struct JsScannedTrack {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 音轨编号
    pub track: Option<u16>,
    /// 时长（秒）
    pub duration: f64,
    pub codec: String,
    pub sample_rate: u32,
    pub bit_rate: i64,
    pub channels: u32,
    pub bits_per_sample: u32,
    /// 封面缓存路径
    pub cover: Option<String>,
    /// 文件大小（字节）
    pub file_size: f64,
    /// 修改时间（Unix ms）
    pub mtime: f64,
    /// 创建时间（Unix ms）
    pub ctime: f64,
}

impl From<scanner::ScannedTrack> for JsScannedTrack {
    fn from(track: scanner::ScannedTrack) -> Self {
        Self {
            path: track.path,
            title: track.title,
            artist: track.artist,
            album: track.album,
            track: track.track,
            duration: track.duration,
            codec: track.codec,
            sample_rate: track.sample_rate,
            bit_rate: track.bit_rate,
            channels: track.channels,
            bits_per_sample: track.bits_per_sample,
            cover: track.cover,
            file_size: track.file_size as f64,
            mtime: track.mtime as f64,
            ctime: track.ctime as f64,
        }
    }
}

/// 扫描事件回调数据
#[napi(object)]
#[derive(Default)]
pub struct JsScanEvent {
    /// "progress" | "done"
    pub event_type: String,
    /// 已扫描文件数
    pub scanned: u32,
    /// 总文件数
    pub total: u32,
    /// 当前正在处理的文件名
    pub current: Option<String>,
    /// 本批次扫描结果
    pub tracks: Option<Vec<JsScannedTrack>>,
    /// 已删除的文件路径列表（仅 done 事件）
    pub removed_paths: Option<Vec<String>>,
    /// 遍历时收集到的 CUE 文件路径（仅 done 事件）
    pub cue_files: Option<Vec<String>>,
    /// 不可达的扫描目录
    pub unavailable_dirs: Option<Vec<String>>,
}

/// 批量扫描目录，通过回调推送进度和结果
///
/// 在后台线程中执行，不阻塞 Node.js 事件循环。
/// 每处理约 20 个文件回调一次 progress 事件，完成后回调 done 事件。
#[napi(
    ts_args_type = "dirs: Array<string>, callback: (event: JsScanEvent) => void, coverCacheDir?: string | undefined | null, incrementalData?: Array<FileRecord> | undefined | null"
)]
pub fn scan_dirs(
    dirs: Vec<String>,
    callback: Function<JsScanEvent, ()>,
    cover_cache_dir: Option<String>,
    incremental_data: Option<Vec<FileRecord>>,
) -> Result<()> {
    let tsfn = callback.build_threadsafe_function().build()?;

    // 将 JS FileRecord 转为内部类型
    let records: Option<Vec<scanner::FileRecord>> = incremental_data.map(|data| {
        data.into_iter()
            .map(|r| scanner::FileRecord {
                path: r.path,
                mtime: r.mtime as u64,
                size: r.size as u64,
            })
            .collect()
    });

    // 创建取消标志并保存到全局，供 cancel_scan 使用
    let cancel = Arc::new(AtomicBool::new(false));
    *SCAN_CANCEL.lock() = Some(Arc::clone(&cancel));

    thread::spawn(move || {
        let emit = |event: scanner::ScanEvent| {
            let js_event = match event {
                scanner::ScanEvent::Progress {
                    scanned,
                    total,
                    current,
                    tracks,
                } => JsScanEvent {
                    event_type: "progress".into(),
                    scanned,
                    total,
                    current,
                    tracks: Some(tracks.into_iter().map(JsScannedTrack::from).collect()),
                    ..Default::default()
                },
                scanner::ScanEvent::Done {
                    scanned,
                    total,
                    removed_paths,
                    cue_files,
                    unavailable_dirs,
                } => JsScanEvent {
                    event_type: "done".into(),
                    scanned,
                    total,
                    removed_paths: Some(removed_paths),
                    cue_files: Some(cue_files),
                    unavailable_dirs: Some(unavailable_dirs),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        };

        scanner::scan_directories(
            &dirs,
            cover_cache_dir.as_deref(),
            records.as_deref(),
            &cancel,
            &emit,
        );

        // 扫描结束后清除全局取消标志
        *SCAN_CANCEL.lock() = None;
    });

    Ok(())
}

/// 取消正在进行的扫描任务
#[napi]
pub fn cancel_scan() {
    if let Some(cancel) = SCAN_CANCEL.lock().as_ref() {
        cancel.store(true, Ordering::Release);
        info!("已发送扫描取消信号");
    }
}
