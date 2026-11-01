use napi::bindgen_prelude::{Float32Array, Result};
use napi_derive::napi;

use super::IntoNapiResult;

/// 后台导出分离窗口，PCM 通过任务临时文件传递
/// @param source - 本地或完整缓存音源
/// @param startSeconds - 曲目起点秒数
/// @param endSeconds - 曲目终点秒数
/// @param tail - 是否读取曲尾
/// @param target - 任务内的 PCM 输出路径
/// @returns 44100 Hz 双声道帧数
#[napi]
pub async fn export_auto_mix_window(
    source: String,
    start_seconds: f64,
    end_seconds: Option<f64>,
    tail: bool,
    target: String,
) -> Result<u32> {
    tokio::task::spawn_blocking(move || {
        crate::analysis::export_stem_window(&source, start_seconds, end_seconds, tail, &target)
            .into_napi()
    })
    .await
    .map_err(|error| napi::Error::from_reason(error.to_string()))?
}

#[napi(object)]
pub struct JsAutoMixFeatures {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub first_audible_seconds: f64,
    pub last_audible_seconds: f64,
    pub mel: Float32Array,
    /// 每一百毫秒的双声道均方根电平，用于区分主体与残响
    pub levels: Float32Array,
    /// 每一百毫秒的十二维音级能量，仅用于重叠窗口的和声兼容性比较
    pub chroma: Float32Array,
}

/// 在分析进程的后台线程提取有限窗口的模型输入
/// @param source - 本地或完整缓存的音频路径
/// @param startSeconds - 曲目或 CUE 起点，单位为秒
/// @param endSeconds - 曲目或 CUE 终点，单位为秒
/// @param tail - 是否读取尾部窗口
/// @returns 节拍模型输入和源时间范围
#[napi]
pub async fn analyze_auto_mix(
    source: String,
    start_seconds: f64,
    end_seconds: Option<f64>,
    tail: bool,
) -> Result<JsAutoMixFeatures> {
    tokio::task::spawn_blocking(move || {
        let features = crate::analysis::analyze_audio(&source, start_seconds, end_seconds, tail)
            .into_napi()?;
        Ok(JsAutoMixFeatures {
            start_seconds: features.start,
            end_seconds: features.end,
            first_audible_seconds: features.first_audible,
            last_audible_seconds: features.last_audible,
            mel: Float32Array::new(features.mel),
            levels: Float32Array::new(features.levels),
            chroma: Float32Array::new(features.chroma),
        })
    })
    .await
    .map_err(|error| napi::Error::from_reason(error.to_string()))?
}
