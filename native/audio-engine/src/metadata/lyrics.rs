use std::collections::HashMap;
use std::path::Path;

use super::tag_fields;

/// 支持的歌词文件扩展名
const LYRIC_EXTENSIONS: &[&str] = &["ttml", "lys", "qrc", "krc", "yrc", "lrc", "ass", "srt"];

/// 一条外部歌词（仅格式和路径，内容按需加载）
#[derive(Clone)]
pub struct ExternalLyric {
    pub format: String,
    pub path: String,
}

/// 从容器 metadata 提取内嵌歌词
pub fn extract_embedded_lyric(dict: &HashMap<String, String>) -> Option<String> {
    dict.iter()
        .filter(|(key, value)| {
            !value.is_empty() && tag_fields::is_lyric_field_key(&tag_fields::normalize_tag_key(key))
        })
        .max_by_key(|(key, _)| tag_fields::get_lyric_priority(&tag_fields::normalize_tag_key(key)))
        .map(|(_, value)| value.to_string())
}

/// 查找同目录下的所有歌词文件
pub fn find_all_external_lyrics(source: &str) -> Vec<ExternalLyric> {
    let source_path = Path::new(source);
    let mut lyrics = Vec::new();

    for extension in LYRIC_EXTENSIONS {
        let lyric_path = source_path.with_extension(extension);
        if lyric_path.exists() {
            lyrics.push(ExternalLyric {
                format: (*extension).to_string(),
                path: lyric_path.to_string_lossy().into_owned(),
            });
        }
    }

    lyrics
}

#[cfg(test)]
mod tests {
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
}
