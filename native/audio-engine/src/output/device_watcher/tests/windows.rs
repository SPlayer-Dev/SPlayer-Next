use super::*;
use windows::Win32::Media::Audio::{eCapture, eMultimedia, DEVICE_STATE_ACTIVE};

#[test]
fn matches_the_default_output_role_used_by_cpal() {
    assert!(is_output_default_change(eRender, eConsole));
    assert!(!is_output_default_change(eCapture, eConsole));
    assert!(!is_output_default_change(eRender, eMultimedia));
}

#[test]
fn emits_notifications_for_device_list_events() {
    let (commands, receiver) = mpsc::sync_channel(1);
    let client: IMMNotificationClient = DeviceNotificationClient { commands }.into();

    unsafe {
        client
            .OnDeviceStateChanged(PCWSTR::null(), DEVICE_STATE_ACTIVE)
            .unwrap();
    }
    assert!(matches!(
        receiver.try_recv(),
        Ok(WatchCommand::Changed(false))
    ));

    unsafe {
        client.OnDeviceAdded(PCWSTR::null()).unwrap();
    }
    assert!(matches!(
        receiver.try_recv(),
        Ok(WatchCommand::Changed(false))
    ));

    unsafe {
        client.OnDeviceRemoved(PCWSTR::null()).unwrap();
    }
    assert!(matches!(
        receiver.try_recv(),
        Ok(WatchCommand::Changed(false))
    ));

    unsafe {
        client
            .OnPropertyValueChanged(PCWSTR::null(), PROPERTYKEY::default())
            .unwrap();
    }
    assert!(receiver.try_recv().is_err());
}

#[test]
fn emits_default_changes_only_for_the_console_render_role() {
    let (commands, receiver) = mpsc::sync_channel(1);
    let client: IMMNotificationClient = DeviceNotificationClient { commands }.into();

    unsafe {
        client
            .OnDefaultDeviceChanged(eCapture, eConsole, PCWSTR::null())
            .unwrap();
    }
    assert!(receiver.try_recv().is_err());

    unsafe {
        client
            .OnDefaultDeviceChanged(eRender, eConsole, PCWSTR::null())
            .unwrap();
    }
    assert!(matches!(
        receiver.try_recv(),
        Ok(WatchCommand::Changed(true))
    ));
}
