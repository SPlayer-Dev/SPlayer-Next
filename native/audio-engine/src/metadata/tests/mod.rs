use super::*;

#[test]
fn common_tags_are_matched_case_insensitively() {
    let dict = HashMap::from([
        ("TITLE".to_string(), "Track".to_string()),
        ("Album_Artist".to_string(), "Artist".to_string()),
        ("TRACK".to_string(), "7".to_string()),
    ]);

    let tags = extract_tags(&dict);
    assert_eq!(tags.title.as_deref(), Some("Track"));
    assert_eq!(tags.artist.as_deref(), Some("Artist"));
    assert_eq!(tags.track, Some(7));
}

#[test]
fn r128_track_gain_has_priority_and_uses_fixed_point_units() {
    let dict = HashMap::from([
        ("R128_TRACK_GAIN".to_string(), "-1536".to_string()),
        ("replaygain_track_gain".to_string(), "-3.00 dB".to_string()),
    ]);

    assert_eq!(extract_replay_gain(&dict), Some(-6.0));
}

#[test]
fn decibels_are_converted_to_linear_gain() {
    assert!((db_to_linear(-6.0) - 0.501_187_2).abs() < 0.000_001);
}
