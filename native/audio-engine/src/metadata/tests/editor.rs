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
fn temp_paths_are_unique_for_concurrent_edits() {
    let original = Path::new("album").join("track.flac");
    let handles: [_; 32] = std::array::from_fn(|_| {
        let original = original.clone();
        std::thread::spawn(move || temp_path(&original))
    });
    let paths: std::collections::HashSet<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();

    assert_eq!(paths.len(), 32);
    assert!(paths.iter().all(|path| path.parent() == original.parent()));
    assert!(paths.iter().all(|path| {
        path.file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tagedit.tmp")
    }));
}

#[test]
fn read_lyrics_from_custom_unsynced_lyrics_key() {
    let path = temp_wav("custom_unsynced_lyrics.wav");
    let mut tagged = open_tagged(&path).unwrap();
    let tag_type = editing_tag_type(tagged.file_type());

    // 保证 tag 存在，WAV 空文件没有 ID3v2 标签段，需要先 insert
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged.tag_mut(tag_type).unwrap();

    // 写入歌词标签项
    tag.insert_text(ItemKey::UnsyncLyrics, "[00:01.23]测试歌词内容".into());
    tagged.save_to_path(&path, WriteOptions::default()).unwrap();

    let tags = read_tags(&path.to_string_lossy()).unwrap();
    assert_eq!(tags.lyrics.as_deref(), Some("[00:01.23]测试歌词内容"));
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
fn writing_year_replaces_legacy_year_key() {
    let path = temp_wav("legacy-year.wav");
    let init = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("x".into()),
        ..Default::default()
    };
    write_tags(&init).unwrap();

    // 模拟原文件带旧 Year 标签（如 ID3v2.3 TYER）
    let mut tagged = open_tagged(&path).unwrap();
    let tag_type = editing_tag_type(tagged.file_type());
    let tag = tagged.tag_mut(tag_type).unwrap();
    tag.insert_text(ItemKey::Year, "1990".into());
    tagged.save_to_path(&path, WriteOptions::default()).unwrap();

    let update = TagWriteRequest {
        path: init.path.clone(),
        year: Some(2025),
        ..Default::default()
    };
    write_tags(&update).unwrap();
    assert_eq!(read_tags(&init.path).unwrap().year, Some(2025));
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
