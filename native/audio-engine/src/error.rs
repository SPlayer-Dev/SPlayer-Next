//! NAPI 边界错误分类。
//!
//! 分类只读取显式业务标记和稳定的错误类型，不依赖第三方错误文案。

use std::io::ErrorKind;

use ffmpeg_audio::error::HttpError;
use ffmpeg_audio::AudioError;
use rodio::cpal;
use thiserror::Error;

/// 原生层内部使用的稳定错误类别
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioErrorKind {
    NetworkUnreachable,
    SourceNotFound,
    DecodeFailed,
    Device,
    Cancelled,
    Other,
}

/// 附加在 anyhow 错误链中的显式业务分类
#[derive(Error, Debug)]
#[error("audio error kind: {kind:?}")]
struct AudioErrorContext {
    kind: AudioErrorKind,
}

/// 为 anyhow 结果附加稳定业务分类
pub trait AudioResultExt<T> {
    fn with_audio_kind(self, kind: AudioErrorKind) -> anyhow::Result<T>;
}

impl<T> AudioResultExt<T> for anyhow::Result<T> {
    fn with_audio_kind(self, kind: AudioErrorKind) -> anyhow::Result<T> {
        self.map_err(|error| error.context(AudioErrorContext { kind }))
    }
}

/// 暴露给 JS 侧的错误分类
#[derive(Error, Debug)]
pub enum AudioEngineError {
    #[error("network unreachable: {0}")]
    NetworkUnreachable(String),

    #[error("source not found: {0}")]
    SourceNotFound(String),

    #[error("decode failed: {0}")]
    DecodeFailed(String),

    #[error("audio device error: {0}")]
    Device(String),

    #[error("operation cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl AudioEngineError {
    /// 错误码，给 JS 侧用于分支判断
    pub fn code(&self) -> &'static str {
        match self {
            Self::NetworkUnreachable(_) => "NetworkUnreachable",
            Self::SourceNotFound(_) => "SourceNotFound",
            Self::DecodeFailed(_) => "DecodeFailed",
            Self::Device(_) => "Device",
            Self::Cancelled => "Cancelled",
            Self::Other(_) => "Other",
        }
    }

    /// 从显式标记或错误源类型取得稳定分类
    pub fn classify(error: &anyhow::Error) -> Self {
        let kind = error
            .downcast_ref::<AudioErrorContext>()
            .map(|context| context.kind)
            .or_else(|| error.chain().find_map(Self::classify_source))
            .unwrap_or(AudioErrorKind::Other);
        Self::from_kind(kind, format!("{error:#}"))
    }

    fn classify_source(source: &(dyn std::error::Error + 'static)) -> Option<AudioErrorKind> {
        if let Some(context) = source.downcast_ref::<AudioErrorContext>() {
            return Some(context.kind);
        }
        if let Some(error) = source.downcast_ref::<std::io::Error>() {
            return Some(match error.kind() {
                ErrorKind::NotFound => AudioErrorKind::SourceNotFound,
                ErrorKind::Interrupted => AudioErrorKind::Cancelled,
                ErrorKind::TimedOut
                | ErrorKind::ConnectionRefused
                | ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::NotConnected
                | ErrorKind::AddrNotAvailable
                | ErrorKind::BrokenPipe => AudioErrorKind::NetworkUnreachable,
                _ => return None,
            });
        }
        if let Some(error) = source.downcast_ref::<AudioError>() {
            return Some(Self::classify_audio_error(error));
        }
        if source.downcast_ref::<cpal::BuildStreamError>().is_some()
            || source
                .downcast_ref::<cpal::DefaultStreamConfigError>()
                .is_some()
            || source.downcast_ref::<cpal::DevicesError>().is_some()
            || source.downcast_ref::<cpal::DeviceNameError>().is_some()
            || source.downcast_ref::<rodio::DeviceSinkError>().is_some()
        {
            return Some(AudioErrorKind::Device);
        }
        None
    }

    fn classify_audio_error(error: &AudioError) -> AudioErrorKind {
        match error {
            AudioError::Http(HttpError::Status(404 | 410)) => AudioErrorKind::SourceNotFound,
            AudioError::Http(HttpError::Cancelled) => AudioErrorKind::Cancelled,
            AudioError::Http(HttpError::Timeout | HttpError::Transport(_)) => {
                AudioErrorKind::NetworkUnreachable
            }
            AudioError::Http(_)
            | AudioError::FFmpeg(_, _)
            | AudioError::FormatMismatch
            | AudioError::InvalidData(_) => AudioErrorKind::DecodeFailed,
            AudioError::Io(error) => match error.kind() {
                ErrorKind::NotFound => AudioErrorKind::SourceNotFound,
                ErrorKind::Interrupted => AudioErrorKind::Cancelled,
                ErrorKind::TimedOut
                | ErrorKind::ConnectionRefused
                | ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::NotConnected
                | ErrorKind::AddrNotAvailable
                | ErrorKind::BrokenPipe => AudioErrorKind::NetworkUnreachable,
                _ => AudioErrorKind::DecodeFailed,
            },
            AudioError::Eof
            | AudioError::Eagain
            | AudioError::InvalidParameter(_)
            | AudioError::AllocationFailed(_) => AudioErrorKind::Other,
        }
    }

    fn from_kind(kind: AudioErrorKind, message: String) -> Self {
        match kind {
            AudioErrorKind::NetworkUnreachable => Self::NetworkUnreachable(message),
            AudioErrorKind::SourceNotFound => Self::SourceNotFound(message),
            AudioErrorKind::DecodeFailed => Self::DecodeFailed(message),
            AudioErrorKind::Device => Self::Device(message),
            AudioErrorKind::Cancelled => Self::Cancelled,
            AudioErrorKind::Other => Self::Other(message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    #[test]
    fn explicit_kind_wins_over_misleading_message() {
        let error = Err::<(), _>(anyhow!("network timeout in decoder text"))
            .with_audio_kind(AudioErrorKind::DecodeFailed)
            .unwrap_err();

        assert!(matches!(
            AudioEngineError::classify(&error),
            AudioEngineError::DecodeFailed(_)
        ));
    }

    #[test]
    fn arbitrary_message_is_not_classified_by_keywords() {
        let error = anyhow!("network timeout not found");

        assert!(matches!(
            AudioEngineError::classify(&error),
            AudioEngineError::Other(_)
        ));
    }

    #[test]
    fn io_not_found_is_source_not_found() {
        let error = anyhow::Error::new(std::io::Error::from(ErrorKind::NotFound));

        assert!(matches!(
            AudioEngineError::classify(&error),
            AudioEngineError::SourceNotFound(_)
        ));
    }

    #[test]
    fn typed_http_errors_have_stable_categories() {
        let missing = anyhow::Error::new(AudioError::Http(HttpError::Status(404)));
        let transport = anyhow::Error::new(AudioError::Http(HttpError::Transport("x".into())));

        assert!(matches!(
            AudioEngineError::classify(&missing),
            AudioEngineError::SourceNotFound(_)
        ));
        assert!(matches!(
            AudioEngineError::classify(&transport),
            AudioEngineError::NetworkUnreachable(_)
        ));
    }

    #[test]
    fn rodio_device_sink_errors_are_device_errors() {
        let error = anyhow::Error::new(rodio::DeviceSinkError::NoDevice);

        assert!(matches!(
            AudioEngineError::classify(&error),
            AudioEngineError::Device(_)
        ));
    }
}
