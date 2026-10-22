use super::*;
use std::fs;
use std::path::PathBuf;

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir()
        .join("splayer-folder-cover-tests")
        .join(format!("{}-{}", std::process::id(), unique_counter()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn unique_counter() -> u64 {
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn touch(dir: &Path, name: &str) {
    fs::write(dir.join(name), b"fake image").unwrap();
}

fn cleanup(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn finds_cover_jpg() {
    let dir = temp_dir();
    touch(&dir, "cover.jpg");
    touch(&dir, "song.flac");

    let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
    assert_eq!(
        result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
        Some("cover.jpg".to_string())
    );
    cleanup(&dir);
}

#[test]
fn priority_cover_over_folder() {
    let dir = temp_dir();
    touch(&dir, "cover.png");
    touch(&dir, "folder.jpg");
    touch(&dir, "song.flac");

    let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
    assert_eq!(
        result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
        Some("cover.png".to_string())
    );
    cleanup(&dir);
}

#[test]
fn same_name_as_audio() {
    let dir = temp_dir();
    touch(&dir, "track01.jpg");
    touch(&dir, "other.txt");
    touch(&dir, "track01.flac");

    let result = find_folder_cover(dir.join("track01.flac").to_str().unwrap());
    assert_eq!(
        result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
        Some("track01.jpg".to_string())
    );
    cleanup(&dir);
}

#[test]
fn single_image_in_dir() {
    let dir = temp_dir();
    touch(&dir, "random_name.jpg");
    touch(&dir, "track.flac");

    let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
    assert!(result.is_some());
    cleanup(&dir);
}

#[test]
fn multiple_random_images_returns_none() {
    let dir = temp_dir();
    touch(&dir, "a.jpg");
    touch(&dir, "b.png");
    touch(&dir, "track.flac");

    let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
    assert!(result.is_none());
    cleanup(&dir);
}

#[test]
fn no_images_returns_none() {
    let dir = temp_dir();
    touch(&dir, "track.flac");

    let result = find_folder_cover(dir.join("track.flac").to_str().unwrap());
    assert!(result.is_none());
    cleanup(&dir);
}

#[test]
fn case_insensitive_match() {
    let dir = temp_dir();
    touch(&dir, "Cover.JPG");
    touch(&dir, "song.flac");

    let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
    assert_eq!(
        result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
        Some("Cover.JPG".to_string())
    );
    cleanup(&dir);
}

#[test]
fn files_without_extension_do_not_break_scan() {
    let dir = temp_dir();
    touch(&dir, "cover.jpg");
    touch(&dir, "README");
    touch(&dir, "song.flac");

    let result = find_folder_cover(dir.join("song.flac").to_str().unwrap());
    assert_eq!(
        result.map(|p| p.file_name().unwrap().to_str().unwrap().to_string()),
        Some("cover.jpg".to_string())
    );
    cleanup(&dir);
}
