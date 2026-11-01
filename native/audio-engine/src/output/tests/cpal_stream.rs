use super::*;

#[test]
fn recoverable_notifications_do_not_reopen_output() {
    for kind in [
        cpal::ErrorKind::Xrun,
        cpal::ErrorKind::RealtimeDenied,
        cpal::ErrorKind::DeviceChanged,
    ] {
        assert!(!output_error_requires_rebuild(kind));
    }
    for kind in [
        cpal::ErrorKind::DeviceNotAvailable,
        cpal::ErrorKind::StreamInvalidated,
        cpal::ErrorKind::HostUnavailable,
    ] {
        assert!(output_error_requires_rebuild(kind));
    }
}
