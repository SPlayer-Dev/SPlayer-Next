//! 音频引擎在 N-API 边界使用的稳定错误类别。

use std::io;

use ffmpeg_audio::AudioError;
use thiserror::Error;

/// 暴露给 JS 侧的稳定错误分类。
#[derive(Clone, Error, Debug)]
pub enum AudioEngineError {
    #[error("load superseded by a newer operation")]
    LoadSuperseded,
    #[error("operation cancelled")]
    Cancelled,
    #[error("source error: {0}")]
    Source(String),
    #[error("decode error: {0}")]
    Decode(String),
    #[error("output error: {0}")]
    Output(String),
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl AudioEngineError {
    /// 返回不会随平台文案变化的 N-API 错误码。
    pub fn code(&self) -> &'static str {
        match self {
            Self::LoadSuperseded => "LOAD_SUPERSEDED",
            Self::Cancelled => "CANCELLED",
            Self::Source(_) => "SOURCE_ERROR",
            Self::Decode(_) => "DECODE_ERROR",
            Self::Output(_) => "OUTPUT_ERROR",
            Self::InvalidArgument(_) => "INVALID_ARGUMENT",
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }

    /// 根据错误链中的具体类型分类，不解析展示文案。
    pub fn classify(err: &anyhow::Error) -> Self {
        for cause in err.chain() {
            if let Some(engine_error) = cause.downcast_ref::<Self>() {
                return engine_error.clone();
            }
            if let Some(io_error) = cause.downcast_ref::<io::Error>() {
                return match io_error.kind() {
                    io::ErrorKind::Interrupted => Self::Cancelled,
                    io::ErrorKind::NotFound => Self::Source(io_error.to_string()),
                    _ => Self::Source(io_error.to_string()),
                };
            }
            if cause.downcast_ref::<AudioError>().is_some() {
                return Self::Decode(cause.to_string());
            }
            if cause.downcast_ref::<cpal::Error>().is_some() {
                return Self::Output(cause.to_string());
            }
            if cause.downcast_ref::<ureq::Error>().is_some() {
                return Self::Source(cause.to_string());
            }
        }
        Self::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::AudioEngineError;

    #[test]
    fn classifies_cancelled_io_without_matching_message_text() {
        let error = anyhow::Error::new(io::Error::from(io::ErrorKind::Interrupted));
        assert_eq!(AudioEngineError::classify(&error).code(), "CANCELLED");
    }

    #[test]
    fn classifies_missing_file_as_source_error() {
        let error = anyhow::Error::new(io::Error::from(io::ErrorKind::NotFound));
        assert_eq!(AudioEngineError::classify(&error).code(), "SOURCE_ERROR");
    }

    #[test]
    fn preserves_engine_error_code_through_anyhow_context() {
        let error =
            anyhow::Error::new(AudioEngineError::LoadSuperseded).context("load transaction");
        assert_eq!(AudioEngineError::classify(&error).code(), "LOAD_SUPERSEDED");
    }
}
