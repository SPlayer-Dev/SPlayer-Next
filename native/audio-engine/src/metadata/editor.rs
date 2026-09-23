//! 本地文件标签读写（lofty）
//!
//! 写入安全策略：复制原文件到同目录临时文件 → 修改临时文件 → 原子 rename 覆盖原文件。
//! Windows 下 std::fs::rename 使用 MOVEFILE_REPLACE_EXISTING，可覆盖已存在目标。
//!
//! 字段语义：
//! - `None` = 不修改该字段
//! - 文本字段 `Some("")` = 清除该标签项
//! - 数字字段 `Some(0)` = 清除该标签项
//! - 封面 `Some(bytes)` = 替换，`None` = 保留

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result};
use lofty::config::WriteOptions;
use lofty::file::TaggedFile;
use lofty::file::{FileType, TaggedFileExt};
use lofty::picture::{Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag, TagType};

/// 可编辑标签的读取结果
#[derive(Debug, Default, PartialEq)]
pub struct TrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub lyrics: Option<String>,
    pub has_cover: bool,
}

/// 单文件写入请求
#[derive(Debug, Default)]
pub struct TagWriteRequest {
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
    pub cover: Option<Vec<u8>>,
}

/// 选择读写操作的目标 tag 类型。
/// WAV 的 primary 是 RIFF INFO，存不了歌词和封面，统一走 ID3v2 chunk
fn editing_tag_type(file_type: FileType) -> TagType {
    match file_type {
        FileType::Wav => TagType::Id3v2,
        other => other.primary_tag_type(),
    }
}

/// 打开并解析文件，按内容嗅探格式（不信任扩展名，临时文件无正确扩展名）
fn open_tagged(path: &Path) -> Result<TaggedFile> {
    Probe::open(path)
        .context("打开文件失败")?
        .guess_file_type()
        .context("识别文件格式失败")?
        .read()
        .context("解析音频文件失败")
}

/// 读取文件的全部可编辑标签
pub fn read_tags(path: &str) -> Result<TrackTags> {
    let tagged = open_tagged(Path::new(path))?;
    let tag = tagged
        .tag(editing_tag_type(tagged.file_type()))
        .or_else(|| tagged.primary_tag())
        .or_else(|| tagged.first_tag());
    let Some(tag) = tag else {
        return Ok(TrackTags::default());
    };
    Ok(TrackTags {
        title: tag.title().map(|v| v.into_owned()),
        artist: tag.artist().map(|v| v.into_owned()),
        album: tag.album().map(|v| v.into_owned()),
        album_artist: tag.get_string(ItemKey::AlbumArtist).map(str::to_string),
        year: read_year(tag),
        genre: tag.genre().map(|v| v.into_owned()),
        track_number: tag.track(),
        disc_number: tag.disk(),
        lyrics: read_lyrics_from_tag(tag),
        has_cover: !tag.pictures().is_empty(),
    })
}

/// 读年份：Year 优先，回退 RecordingDate（取前 4 位数字）
fn read_year(tag: &Tag) -> Option<u32> {
    tag.get_string(ItemKey::Year)
        .or_else(|| tag.get_string(ItemKey::RecordingDate))
        .and_then(|raw| raw.get(..4).or(Some(raw)))
        .and_then(|raw| raw.parse::<u32>().ok())
}

/// 从 tag 读取歌词，优先使用 ItemKey，回退时对未知/自定义 key 进行归一化匹配（如 "UNSYNCED LYRICS"）
fn read_lyrics_from_tag(tag: &Tag) -> Option<String> {
    if let Some(lyrics) = tag
        .get_string(ItemKey::UnsyncLyrics)
        .or_else(|| tag.get_string(ItemKey::Lyrics))
    {
        return Some(lyrics.to_string());
    }

    // 遍历所有 items 寻找最优歌词标签
    tag.items()
        .filter_map(|item| {
            let key_str = format!("{:?}", item.key());
            let norm = super::tag_fields::normalize_tag_key(&key_str);
            if super::tag_fields::is_lyric_field_key(&norm) {
                if let Some(val) = item.value().text() {
                    if !val.is_empty() {
                        return Some((
                            val.to_string(),
                            super::tag_fields::get_lyric_priority(&norm),
                        ));
                    }
                }
            }
            None
        })
        .max_by_key(|(_, priority)| *priority)
        .map(|(val, _)| val)
}

/// 文本字段语义：None 不动，空串清除，非空覆盖
fn apply_text(tag: &mut Tag, key: ItemKey, value: &Option<String>) {
    match value {
        None => {}
        Some(text) if text.is_empty() => {
            tag.remove_key(key);
        }
        Some(text) => {
            tag.insert_text(key, text.clone());
        }
    }
}

/// 把写入请求应用到指定文件（直接修改该文件，调用方负责 temp + rename）
fn apply_to_file(path: &Path, request: &TagWriteRequest) -> Result<()> {
    let mut tagged = open_tagged(path)?;
    let tag_type = editing_tag_type(tagged.file_type());
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged.tag_mut(tag_type).expect("tag 必然存在");

    match request.title {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_title(),
        Some(ref text) => tag.set_title(text.clone()),
    }
    match request.artist {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_artist(),
        Some(ref text) => tag.set_artist(text.clone()),
    }
    match request.album {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_album(),
        Some(ref text) => tag.set_album(text.clone()),
    }
    match request.genre {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_genre(),
        Some(ref text) => tag.set_genre(text.clone()),
    }
    match request.year {
        None => {}
        Some(0) => {
            tag.remove_key(ItemKey::Year);
            tag.remove_key(ItemKey::RecordingDate);
        }
        Some(year) => {
            tag.remove_key(ItemKey::Year);
            tag.insert_text(ItemKey::RecordingDate, year.to_string());
        }
    }
    match request.track_number {
        None => {}
        Some(0) => tag.remove_track(),
        Some(track) => tag.set_track(track),
    }
    match request.disc_number {
        None => {}
        Some(0) => tag.remove_disk(),
        Some(disk) => tag.set_disk(disk),
    }
    apply_text(tag, ItemKey::AlbumArtist, &request.album_artist);
    // ID3v2 只认 UnsyncLyrics（USLT），其他格式两者等价；清除时两个键都清
    if request.lyrics.as_deref() == Some("") {
        tag.remove_key(ItemKey::Lyrics);
    }
    apply_text(tag, ItemKey::UnsyncLyrics, &request.lyrics);

    if let Some(ref data) = request.cover {
        // from_reader 校验图片签名并识别 mime，非图片数据直接报错
        let mut picture = Picture::from_reader(&mut data.as_slice()).context("封面图片数据无效")?;
        picture.set_pic_type(PictureType::CoverFront);
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
        tag.push_picture(picture);
    }

    tagged
        .save_to_path(path, WriteOptions::default())
        .context("写入标签失败")?;
    Ok(())
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成同目录且进程内唯一的临时文件路径
fn temp_path(original: &Path) -> PathBuf {
    let mut name = original
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    name.push(format!(".{}.{}.tagedit.tmp", std::process::id(), sequence));
    original.with_file_name(name)
}

/// 写入标签（temp + rename，崩溃不损坏原文件）
pub fn write_tags(request: &TagWriteRequest) -> Result<()> {
    let original = Path::new(&request.path);
    anyhow::ensure!(original.is_file(), "文件不存在: {}", request.path);

    let temp = temp_path(original);
    fs::copy(original, &temp).context("创建临时副本失败")?;

    let applied = apply_to_file(&temp, request)
        // Windows 下 rename 可原子覆盖已存在目标（MOVEFILE_REPLACE_EXISTING）
        .and_then(|()| fs::rename(&temp, original).context("覆盖原文件失败"));
    if applied.is_err() {
        let _ = fs::remove_file(&temp);
    }
    applied
}

#[cfg(test)]
#[path = "tests/editor.rs"]
mod tests;
