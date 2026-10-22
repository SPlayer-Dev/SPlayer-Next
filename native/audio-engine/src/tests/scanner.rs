use super::*;

#[test]
fn traversal_error_suppresses_removals_for_the_whole_root() {
    let root = Path::new("music");
    let visible = root.join("visible.mp3").to_string_lossy().into_owned();
    let hidden = root.join("restricted").join("hidden.flac");
    let outside = Path::new("other").join("removed.ogg");
    let hidden = hidden.to_string_lossy().into_owned();
    let outside = outside.to_string_lossy().into_owned();
    let existing = HashMap::from([
        (visible.as_str(), (1, 1)),
        (hidden.as_str(), (1, 1)),
        (outside.as_str(), (1, 1)),
    ]);

    let removed = collect_removed_paths(
        &existing,
        std::slice::from_ref(&visible),
        &[root.to_string_lossy().into_owned()],
    );

    assert_eq!(removed, vec![outside]);
}

#[test]
fn complete_scan_reports_missing_paths() {
    let present = Path::new("music")
        .join("present.mp3")
        .to_string_lossy()
        .into_owned();
    let missing = Path::new("music")
        .join("missing.mp3")
        .to_string_lossy()
        .into_owned();
    let existing = HashMap::from([(present.as_str(), (1, 1)), (missing.as_str(), (1, 1))]);

    let removed = collect_removed_paths(&existing, std::slice::from_ref(&present), &[]);

    assert_eq!(removed, vec![missing]);
}
