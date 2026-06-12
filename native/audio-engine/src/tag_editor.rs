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
        lyrics: tag
            .get_string(ItemKey::UnsyncLyrics)
            .or_else(|| tag.get_string(ItemKey::Lyrics))
            .map(str::to_string),
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
            // ID3v2.4 的 TYER 已废弃，统一写 RecordingDate（TDRC / DATE / ©day）
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

/// 同目录临时文件路径：{文件名}.tagedit.tmp
fn temp_path(original: &Path) -> PathBuf {
    let mut name = original
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tagedit.tmp");
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
mod tests {
    use super::*;
    use std::path::Path;

    /// 生成一个最小可用的 48k 立体声 16bit WAV（含 0.1s 静音数据）
    fn make_wav(path: &Path) {
        let sample_rate: u32 = 48000;
        let frames: u32 = sample_rate / 10;
        let data_size = frames * 4;
        let mut buf = Vec::with_capacity(44 + data_size as usize);
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_size).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&(sample_rate * 4).to_le_bytes());
        buf.extend_from_slice(&4u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_size.to_le_bytes());
        buf.resize(44 + data_size as usize, 0);
        std::fs::write(path, buf).unwrap();
    }

    fn temp_wav(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("splayer-tag-editor-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        make_wav(&path);
        path
    }

    #[test]
    fn roundtrip_all_fields() {
        let path = temp_wav("roundtrip.wav");
        let request = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            title: Some("测试标题".into()),
            artist: Some("歌手A/歌手B".into()),
            album: Some("专辑名".into()),
            album_artist: Some("专辑歌手".into()),
            year: Some(2024),
            genre: Some("Pop".into()),
            track_number: Some(3),
            disc_number: Some(1),
            lyrics: Some("第一行歌词\n第二行歌词".into()),
            cover: None,
        };
        write_tags(&request).unwrap();

        let tags = read_tags(&request.path).unwrap();
        assert_eq!(tags.title.as_deref(), Some("测试标题"));
        assert_eq!(tags.artist.as_deref(), Some("歌手A/歌手B"));
        assert_eq!(tags.album.as_deref(), Some("专辑名"));
        assert_eq!(tags.album_artist.as_deref(), Some("专辑歌手"));
        assert_eq!(tags.year, Some(2024));
        assert_eq!(tags.genre.as_deref(), Some("Pop"));
        assert_eq!(tags.track_number, Some(3));
        assert_eq!(tags.disc_number, Some(1));
        assert_eq!(tags.lyrics.as_deref(), Some("第一行歌词\n第二行歌词"));
        assert!(!tags.has_cover);
    }

    #[test]
    fn none_fields_are_untouched() {
        let path = temp_wav("untouched.wav");
        let full = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            title: Some("原标题".into()),
            artist: Some("原歌手".into()),
            album: Some("原专辑".into()),
            ..Default::default()
        };
        write_tags(&full).unwrap();

        // 只改标题，其余 None
        let partial = TagWriteRequest {
            path: full.path.clone(),
            title: Some("新标题".into()),
            ..Default::default()
        };
        write_tags(&partial).unwrap();

        let tags = read_tags(&full.path).unwrap();
        assert_eq!(tags.title.as_deref(), Some("新标题"));
        assert_eq!(tags.artist.as_deref(), Some("原歌手"));
        assert_eq!(tags.album.as_deref(), Some("原专辑"));
    }

    #[test]
    fn empty_string_clears_field() {
        let path = temp_wav("clear.wav");
        let full = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            genre: Some("Rock".into()),
            lyrics: Some("有歌词".into()),
            year: Some(1999),
            ..Default::default()
        };
        write_tags(&full).unwrap();

        let clear = TagWriteRequest {
            path: full.path.clone(),
            genre: Some(String::new()),
            lyrics: Some(String::new()),
            year: Some(0),
            ..Default::default()
        };
        write_tags(&clear).unwrap();

        let tags = read_tags(&full.path).unwrap();
        assert_eq!(tags.genre, None);
        assert_eq!(tags.lyrics, None);
        assert_eq!(tags.year, None);
    }

    #[test]
    fn cover_replace_sets_picture() {
        let path = temp_wav("cover.wav");
        // 仅需 JPEG 魔数即可（写入不解码图片）
        let fake_jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02, 0x03, 0x04];
        let request = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            cover: Some(fake_jpeg),
            ..Default::default()
        };
        write_tags(&request).unwrap();

        let tags = read_tags(&request.path).unwrap();
        assert!(tags.has_cover);

        // 再次替换为 PNG，应该还是恰好一张封面
        let fake_png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xAA];
        let replace = TagWriteRequest {
            path: request.path.clone(),
            cover: Some(fake_png),
            ..Default::default()
        };
        write_tags(&replace).unwrap();

        use lofty::file::TaggedFileExt;
        let tagged = lofty::read_from_path(&request.path).unwrap();
        let picture_count: usize = tagged.tags().iter().map(|t| t.pictures().len()).sum();
        assert_eq!(picture_count, 1);
    }

    #[test]
    fn invalid_file_leaves_original_intact() {
        let dir = std::env::temp_dir().join("splayer-tag-editor-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not-audio.wav");
        let content = b"this is not a wav file at all";
        std::fs::write(&path, content).unwrap();

        let request = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            title: Some("x".into()),
            ..Default::default()
        };
        assert!(write_tags(&request).is_err());
        // 原文件内容未被破坏，且没有残留临时文件
        assert_eq!(std::fs::read(&path).unwrap(), content);
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("not-audio.wav."))
            .count();
        assert_eq!(leftovers, 0);
    }
}
