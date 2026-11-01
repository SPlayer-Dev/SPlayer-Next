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
fn cpal_errors_are_device_errors() {
    let error = anyhow::Error::new(cpal::Error::from(cpal::ErrorKind::DeviceBusy));

    assert!(matches!(
        AudioEngineError::classify(&error),
        AudioEngineError::Device(_)
    ));
}
