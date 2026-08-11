use napi::bindgen_prelude::*;
use napi_derive::napi;
use tracing::{info, warn};

use crate::{metadata, scanner};

use super::scanner::JsScannedTrack;
use super::IntoNapiResult;

/// 可编辑标签（读取结果）
#[napi(object)]
pub struct JsTrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    /// 内嵌歌词纯文本
    pub lyrics: Option<String>,
    /// 是否有内嵌封面
    pub has_cover: bool,
}

/// 单文件标签写入请求。字段为 undefined/null 表示不修改；
/// 文本传空串、数字传 0 表示清除该标签项
#[napi(object)]
pub struct JsTagWriteRequest {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub lyrics: Option<String>,
    /// 新封面图片数据（jpg/png），undefined 表示保留现有封面
    pub cover: Option<Buffer>,
}

/// 单文件写入结果
#[napi(object)]
pub struct JsTagWriteResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
    /// 写入成功后重新探测的元数据
    pub track: Option<JsScannedTrack>,
}

/// 把任意图片字节缩成 JPEG 缩略图（用于选图预览）
/// 渲染层只拿小缩略图，避免整图解码成位图占用大量内存
#[napi]
pub async fn make_image_thumbnail(data: Buffer, max_size: u32) -> Result<Buffer> {
    let bytes = data.to_vec();
    let thumb =
        tokio::task::spawn_blocking(move || metadata::make_thumbnail_jpeg(&bytes, max_size))
            .await
            .map_err(|e| Error::from_reason(format!("缩略图任务失败: {e}")))?
            .into_napi()?;
    Ok(thumb.into())
}

/// 读取文件的可编辑标签（异步，阻塞 IO 在 tokio 阻塞线程执行）
#[napi]
pub async fn read_track_tags(path: String) -> Result<JsTrackTags> {
    let tags = tokio::task::spawn_blocking(move || metadata::read_tags(&path))
        .await
        .map_err(|e| Error::from_reason(format!("读取标签任务失败: {e}")))?
        .into_napi()?;
    Ok(JsTrackTags {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        year: tags.year,
        genre: tags.genre,
        track_number: tags.track_number,
        disc_number: tags.disc_number,
        lyrics: tags.lyrics,
        has_cover: tags.has_cover,
    })
}

/// 写入后重新探测单文件元数据，补全文件时间与大小
fn probe_after_write(path: &str, cover_cache_dir: Option<&str>) -> Option<JsScannedTrack> {
    let mut track = scanner::probe_fast(path, cover_cache_dir)?;
    if let Some((mtime, ctime, size)) = scanner::file_stat(std::path::Path::new(path)) {
        track.mtime = mtime;
        track.ctime = ctime;
        track.file_size = size;
    }
    Some(JsScannedTrack::from(track))
}

/// 批量写入标签（异步），逐项返回结果，单项失败不中断整批。
/// 替换封面时会作废旧缩略图缓存，写后按扫描同等规则重新生成
#[napi]
pub async fn write_track_tags(
    requests: Vec<JsTagWriteRequest>,
    cover_cache_dir: Option<String>,
) -> Result<Vec<JsTagWriteResult>> {
    // Buffer 数据在进入阻塞线程前拷出
    let internal: Vec<metadata::TagWriteRequest> = requests
        .into_iter()
        .map(|request| metadata::TagWriteRequest {
            path: request.path,
            title: request.title,
            artist: request.artist,
            album: request.album,
            album_artist: request.album_artist,
            year: request.year,
            genre: request.genre,
            track_number: request.track_number,
            disc_number: request.disc_number,
            lyrics: request.lyrics,
            cover: request.cover.map(|buffer| buffer.to_vec()),
        })
        .collect();

    tokio::task::spawn_blocking(move || {
        internal
            .iter()
            .map(|request| {
                if let Err(error) = metadata::write_tags(request) {
                    warn!(path = %request.path, "标签写入失败: {error:#}");
                    return JsTagWriteResult {
                        path: request.path.clone(),
                        success: false,
                        error: Some(format!("{error:#}")),
                        track: None,
                    };
                }
                // 封面已替换：删除旧缩略图，probe 时按新封面重新生成
                if request.cover.is_some() {
                    if let Some(ref dir) = cover_cache_dir {
                        let _ =
                            std::fs::remove_file(metadata::cover_thumb_path(&request.path, dir));
                    }
                }
                info!(path = %request.path, "标签写入成功");
                JsTagWriteResult {
                    path: request.path.clone(),
                    success: true,
                    error: None,
                    track: probe_after_write(&request.path, cover_cache_dir.as_deref()),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| Error::from_reason(format!("标签写入任务失败: {e}")))
}
