//! OpenCC 中文简繁转换原生模块（基于 ferrous-opencc）
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

use ferrous_opencc::config::BuiltinConfig;
use ferrous_opencc::OpenCC;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

static CONVERTER_CACHE: LazyLock<RwLock<HashMap<String, OpenCC>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn parse_builtin_config(config_name: &str) -> Option<BuiltinConfig> {
    match config_name.to_ascii_lowercase().as_str() {
        "s2t" => Some(BuiltinConfig::S2t),
        "t2s" => Some(BuiltinConfig::T2s),
        "s2tw" => Some(BuiltinConfig::S2tw),
        "tw2s" => Some(BuiltinConfig::Tw2s),
        "s2hk" => Some(BuiltinConfig::S2hk),
        "hk2s" => Some(BuiltinConfig::Hk2s),
        "s2twp" => Some(BuiltinConfig::S2twp),
        "tw2sp" => Some(BuiltinConfig::Tw2sp),
        "t2tw" => Some(BuiltinConfig::T2tw),
        "tw2t" => Some(BuiltinConfig::Tw2t),
        "t2hk" => Some(BuiltinConfig::T2hk),
        "hk2t" => Some(BuiltinConfig::Hk2t),
        "jp2t" => Some(BuiltinConfig::Jp2t),
        "t2jp" => Some(BuiltinConfig::T2jp),
        _ => None,
    }
}

fn with_opencc<F, R>(config_key: &str, builtin: BuiltinConfig, f: F) -> Result<R>
where
    F: FnOnce(&OpenCC) -> R,
{
    // 读锁优先
    if let Ok(cache) = CONVERTER_CACHE.read() {
        if let Some(opencc) = cache.get(config_key) {
            return Ok(f(opencc));
        }
    }

    // 未命中则获取写锁并初始化
    let mut cache = CONVERTER_CACHE
        .write()
        .map_err(|e| Error::from_reason(format!("无法获取 OpenCC 缓存锁: {e}")))?;

    if !cache.contains_key(config_key) {
        let instance = OpenCC::from_config(builtin)
            .map_err(|e| Error::from_reason(format!("初始化 OpenCC 失败 ({builtin:?}): {e}")))?;
        cache.insert(config_key.to_string(), instance);
    }

    let instance = cache
        .get(config_key)
        .ok_or_else(|| Error::from_reason("获取 OpenCC 实例失败"))?;

    Ok(f(instance))
}

/// 转换单个文本
///
/// @param text - 待转换文本
/// @param config - OpenCC 配置名称 (如 "s2t", "t2s", "s2tw", "tw2s", "s2hk", "hk2s", "s2twp", "tw2sp", "t2tw", "tw2t", "t2hk", "hk2t", "jp2t", "t2jp")
/// @returns 转换后的文本
#[napi]
pub fn convert(text: String, config: String) -> Result<String> {
    if text.is_empty() || config.is_empty() || config.eq_ignore_ascii_case("none") {
        return Ok(text);
    }

    let normalized_config = config.trim().to_ascii_lowercase();
    let builtin = parse_builtin_config(&normalized_config).ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            format!("不支持的 OpenCC 配置名: {config}"),
        )
    })?;

    with_opencc(&normalized_config, builtin, |opencc| {
        opencc.convert(&text)
    })
}

/// 批量转换文本列表
///
/// @param texts - 待转换文本数组
/// @param config - OpenCC 配置名称
/// @returns 转换后的文本数组
#[napi]
pub fn convert_batch(texts: Vec<String>, config: String) -> Result<Vec<String>> {
    if texts.is_empty() || config.is_empty() || config.eq_ignore_ascii_case("none") {
        return Ok(texts);
    }

    let normalized_config = config.trim().to_ascii_lowercase();
    let builtin = parse_builtin_config(&normalized_config).ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            format!("不支持的 OpenCC 配置名: {config}"),
        )
    })?;

    with_opencc(&normalized_config, builtin, |opencc| {
        texts.iter().map(|t| opencc.convert(t)).collect()
    })
}

/// 获取所有支持的内置配置名称列表
#[napi]
pub fn get_supported_configs() -> Result<Vec<String>> {
    Ok(vec![
        "s2t".to_string(),
        "t2s".to_string(),
        "s2tw".to_string(),
        "tw2s".to_string(),
        "s2hk".to_string(),
        "hk2s".to_string(),
        "s2twp".to_string(),
        "tw2sp".to_string(),
        "t2tw".to_string(),
        "tw2t".to_string(),
        "t2hk".to_string(),
        "hk2t".to_string(),
        "jp2t".to_string(),
        "t2jp".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_s2t_and_t2s() {
        let simplified = "开放中文转换是完全由 Rust 实现的。";
        let traditional = convert(simplified.to_string(), "s2t".to_string()).unwrap();
        assert_eq!(traditional, "開放中文轉換是完全由 Rust 實現的。");

        let back_to_simplified = convert(traditional, "t2s".to_string()).unwrap();
        assert_eq!(back_to_simplified, simplified);
    }

    #[test]
    fn test_convert_batch() {
        let texts = vec!["简体中文".to_string(), "内存优化".to_string()];
        let results = convert_batch(texts, "s2t".to_string()).unwrap();
        assert_eq!(results, vec!["簡體中文", "內存優化"]);
    }
}
