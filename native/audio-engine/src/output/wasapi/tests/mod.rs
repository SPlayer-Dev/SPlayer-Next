use super::*;

#[test]
fn initialization_errors_keep_their_fallback_reason_through_context() {
    use windows::Win32::Media::Audio::AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED;

    for (code, reason) in [
        (AUDCLNT_E_DEVICE_IN_USE, "deviceBusy"),
        (AUDCLNT_E_UNSUPPORTED_FORMAT, "formatUnsupported"),
        (AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED, "unavailable"),
    ] {
        let error = anyhow::Error::new(windows::core::Error::from_hresult(code))
            .context("初始化独占模式音频客户端失败");
        assert_eq!(fallback_reason(&error), reason);
    }
}
