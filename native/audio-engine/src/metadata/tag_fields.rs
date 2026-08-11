//! 音频标签键名的归一化与歌词字段识别规则。

/// 归一化键名：转小写并过滤非英文字母与数字（去除空格、下划线、连字符等标点）
pub fn normalize_tag_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// 判断一个归一化后的键名是否为可能的歌词字段
pub fn is_lyric_field_key(norm_key: &str) -> bool {
    let prefixes = [
        "unsyncedlyrics",
        "syncedlyrics",
        "lyrics",
        "uslt",
        "sylt",
        "lyric",
    ];

    for prefix in &prefixes {
        if norm_key.starts_with(prefix) {
            return true;
        }
    }

    false
}

/// 获取歌词字段优先级：
/// - 2 (高优先级)：用于同步歌词（如 syncedlyrics, sylt, lyrics）
/// - 1 (低优先级)：用于非同步歌词（如 unsyncedlyrics, uslt, lyric）
/// - 0 (无效)：非歌词字段
pub fn get_lyric_priority(norm_key: &str) -> u8 {
    if !is_lyric_field_key(norm_key) {
        return 0;
    }
    if norm_key.starts_with("lyrics")
        || norm_key.starts_with("syncedlyrics")
        || norm_key.starts_with("sylt")
    {
        return 2;
    }
    if norm_key.starts_with("unsyncedlyrics")
        || norm_key.starts_with("uslt")
        || norm_key.starts_with("lyric")
    {
        return 1;
    }
    1
}

#[cfg(test)]
mod tests {
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
}
