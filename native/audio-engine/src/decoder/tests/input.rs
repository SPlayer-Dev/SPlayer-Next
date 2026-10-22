use super::*;
use ffmpeg_audio::{AudioReader, SeekMode};
use std::io::Cursor;
use std::time::Duration;

const MP4: &[u8] = b"\x00\x00\x00\x10ftypM4A \x00\x00\x00\x00";

/// 集成测试通过本机 FFmpeg 临时生成正弦波，不向仓库写入音频文件
fn generated_mp4() -> Vec<u8> {
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2:sample_rate=48000",
            "-c:a",
            "aac",
            "-b:a",
            "32k",
            "-movflags",
            "frag_keyframe+empty_moov",
            "-f",
            "mp4",
            "pipe:1",
        ])
        .output()
        .expect("集成测试需要 PATH 中的 ffmpeg");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

/// 模拟云盘在原始容器前插入的 ID3v2 标签，标签体刻意跨过 128 字节边界
fn prefixed(payload: &[u8], version: u8, footer: bool) -> Vec<u8> {
    let mut bytes = vec![
        b'I',
        b'D',
        b'3',
        version,
        0,
        if footer { 0x10 } else { 0 },
        0,
        0,
        2,
        1,
    ];
    bytes.resize(267, 0);
    if footer {
        bytes.extend_from_slice(&[b'3', b'D', b'I', 4, 0, 0x10, 0, 0, 2, 1]);
    }
    bytes.extend_from_slice(payload);
    bytes
}

#[test]
fn id3_mp4_view_has_consistent_offsets_and_length() {
    for (version, footer) in [(2, false), (3, false), (4, false), (4, true)] {
        let mut source = AudioInput::new(Cursor::new(prefixed(MP4, version, footer))).unwrap();
        assert_eq!(source.stream_position().unwrap(), 0);
        assert_eq!(source.seek(SeekFrom::End(0)).unwrap(), MP4.len() as u64);
        assert_eq!(
            source.seek(SeekFrom::End(-8)).unwrap(),
            MP4.len() as u64 - 8
        );
        assert_eq!(source.seek(SeekFrom::Start(4)).unwrap(), 4);
        assert_eq!(source.seek(SeekFrom::Current(-4)).unwrap(), 0);
        assert!(source.seek(SeekFrom::Current(-1)).is_err());
        assert!(source.seek(SeekFrom::Start(u64::MAX)).is_err());
        let mut actual = Vec::new();
        source.read_to_end(&mut actual).unwrap();
        assert_eq!(actual, MP4);
    }
}

#[test]
fn ordinary_and_invalid_inputs_are_not_stripped() {
    let mut invalid_size = prefixed(MP4, 3, false);
    invalid_size[6] = 0x80;
    for bytes in [
        MP4.to_vec(),
        prefixed(b"\xff\xfb ordinary mp3", 3, false),
        prefixed(b"fLaC", 3, false),
        invalid_size,
        b"ID3".to_vec(),
        Vec::new(),
    ] {
        let mut source = AudioInput::new(Cursor::new(bytes.clone())).unwrap();
        let mut actual = Vec::new();
        source.read_to_end(&mut actual).unwrap();
        assert_eq!(actual, bytes);
    }
}

#[test]
#[ignore = "需要本机 FFmpeg 生成临时音频"]
fn ffmpeg_decodes_and_seeks_prefixed_fragmented_mp4() {
    let mp4 = generated_mp4();
    let expected = AudioReader::new(Cursor::new(mp4.clone())).unwrap();
    assert!(AudioReader::new(Cursor::new(prefixed(&mp4, 3, false))).is_err());
    for footer in [false, true] {
        let source = AudioInput::new(Cursor::new(prefixed(&mp4, 4, footer))).unwrap();
        let mut reader = AudioReader::new(source).unwrap();
        assert_eq!(
            reader.source_info().sample_rate,
            expected.source_info().sample_rate
        );
        assert_eq!(
            reader.source_info().channels,
            expected.source_info().channels
        );
        assert_eq!(reader.duration(), expected.duration());
        assert!(reader.receive_frame().unwrap().is_some());
        reader
            .seek(Duration::from_secs(1), SeekMode::Accurate)
            .unwrap();
        assert!(reader.receive_frame().unwrap().is_some());
        reader.seek(Duration::ZERO, SeekMode::Accurate).unwrap();
        assert!(reader.receive_frame().unwrap().is_some());
    }
}

#[test]
#[ignore = "需要本机 FFmpeg 生成临时音频"]
fn local_loading_and_library_probe_accept_mp4_with_mp3_extension() {
    let path = std::env::temp_dir().join(format!("splayer-id3-mp4-{}.mp3", std::process::id()));
    std::fs::write(&path, prefixed(&generated_mp4(), 3, false)).unwrap();
    let path = path.to_str().unwrap();
    let (mut reader, cancel) =
        crate::decoder::reader::open_source(path, ffmpeg_audio::HttpCancelHandle::new()).unwrap();
    assert!(cancel.is_none());
    assert!(reader.receive_frame().unwrap().is_some());
    assert!(crate::scanner::probe_fast(path, None).is_some());
    drop(reader);
    std::fs::remove_file(path).unwrap();
}

#[test]
#[ignore = "需要本机 FFmpeg 生成临时音频"]
fn http_loading_accepts_prefixed_mp4_and_keeps_cancel_handle() {
    let server = httpmock::MockServer::start();
    let bytes = prefixed(&generated_mp4(), 3, false);
    server.mock(|when, then| {
        when.path("/cloud.mp3");
        then.respond_with(move |request| {
            let headers = request.headers();
            let start = headers
                .get("range")
                .unwrap()
                .to_str()
                .unwrap()
                .strip_prefix("bytes=")
                .unwrap()
                .trim_end_matches('-')
                .parse::<usize>()
                .unwrap();
            if start >= bytes.len() {
                return httpmock::HttpMockResponse::builder().status(416).build();
            }
            httpmock::HttpMockResponse::builder()
                .status(206)
                .header("content-type", "audio/mpeg")
                .header(
                    "content-range",
                    format!("bytes {}-{}/{}", start, bytes.len() - 1, bytes.len()),
                )
                .body(bytes[start..].to_vec())
                .build()
        });
    });
    let (mut reader, cancel) = crate::decoder::reader::open_source(
        &server.url("/cloud.mp3"),
        ffmpeg_audio::HttpCancelHandle::new(),
    )
    .unwrap();
    assert!(cancel.is_some());
    assert!(reader.receive_frame().unwrap().is_some());
    reader
        .seek(Duration::from_secs(1), SeekMode::Accurate)
        .unwrap();
    assert!(reader.receive_frame().unwrap().is_some());
}
