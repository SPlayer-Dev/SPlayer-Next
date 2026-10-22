use super::*;

#[test]
fn normalization_ignores_punctuation_and_case() {
    assert_eq!(
        normalize_tag_key("UNSYNCED LYRICS-ENG"),
        "unsyncedlyricseng"
    );
}

#[test]
fn lyric_field_variants_are_recognized_and_prioritized() {
    for key in [
        "lyrics",
        "unsyncedlyrics",
        "syncedlyrics",
        "lyricseng",
        "unsyncedlyricszho",
        "uslt",
        "sylt",
        "lyric",
    ] {
        assert!(is_lyric_field_key(key));
    }

    assert_eq!(get_lyric_priority("syncedlyricseng"), 2);
    assert_eq!(get_lyric_priority("unsyncedlyricszho"), 1);
    assert_eq!(get_lyric_priority("comment"), 0);
}
