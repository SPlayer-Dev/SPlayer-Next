use super::*;

#[test]
fn hides_synthetic_default_devices_from_the_selectable_list() {
    assert_eq!(
        is_synthetic_default_device("default_output"),
        cfg!(target_os = "linux")
    );
    assert_eq!(
        is_synthetic_default_device("default_sink"),
        cfg!(target_os = "linux")
    );
}

#[test]
fn keeps_real_devices_in_the_selectable_list() {
    assert!(!is_synthetic_default_device("Built-in Audio Analog Stereo"));
    assert!(!is_synthetic_default_device("扬声器 (Realtek(R) Audio)"));
}

/// `find_device` 先按 `DeviceId` 解析、失败才回退显示名，旧配置存的显示名必须落到回退分支
#[test]
fn legacy_display_names_do_not_parse_as_device_ids() {
    assert!("扬声器 (Realtek(R) Audio)"
        .parse::<cpal::DeviceId>()
        .is_err());
    assert!("Built-in Audio Analog Stereo"
        .parse::<cpal::DeviceId>()
        .is_err());
    assert!("AppleHDAEngineOutput:1B,0,1,0:0"
        .parse::<cpal::DeviceId>()
        .is_err());
}
