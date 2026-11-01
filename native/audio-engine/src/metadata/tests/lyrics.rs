use super::*;

#[test]
fn synced_lyrics_are_preferred_over_unsynced_lyrics() {
    let dict = HashMap::from([
        ("UNSYNCED LYRICS".to_string(), "plain".to_string()),
        ("SYNCED-LYRICS-ENG".to_string(), "timed".to_string()),
    ]);

    assert_eq!(extract_embedded_lyric(&dict).as_deref(), Some("timed"));
}

#[test]
fn empty_lyric_values_are_ignored() {
    let dict = HashMap::from([
        ("LYRICS".to_string(), String::new()),
        ("COMMENT".to_string(), "not lyrics".to_string()),
    ]);

    assert_eq!(extract_embedded_lyric(&dict), None);
}
