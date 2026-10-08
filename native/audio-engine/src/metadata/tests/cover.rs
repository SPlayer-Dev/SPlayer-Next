use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn test_output_path(name: &str) -> std::path::PathBuf {
    let sequence = TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "splayer-metadata-{}-{sequence}-{name}",
        std::process::id()
    ))
}

#[test]
fn invalid_cover_does_not_create_fake_jpeg() {
    let output = test_output_path("invalid.jpg");
    let _ = std::fs::remove_file(&output);

    assert!(generate_cover_thumbnail(b"not an image", &output).is_err());
    assert!(!output.exists());
}

#[test]
fn png_cover_is_encoded_as_jpeg() {
    let output = test_output_path("converted.jpg");
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();

    generate_cover_thumbnail(png.get_ref(), &output).unwrap();

    let cached = std::fs::read(&output).unwrap();
    assert!(cached.starts_with(&[0xff, 0xd8, 0xff]));
    let _ = std::fs::remove_file(output);
}
