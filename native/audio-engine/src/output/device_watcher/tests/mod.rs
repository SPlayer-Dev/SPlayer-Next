use super::*;

#[test]
fn reports_platform_backend_support() {
    assert_eq!(
        is_supported(),
        cfg!(any(
            target_os = "windows",
            target_os = "linux",
            target_os = "macos"
        ))
    );
}

#[cfg(target_os = "windows")]
#[test]
fn watcher_can_be_stopped_more_than_once() {
    let mut watcher = DeviceWatcher::new(Box::new(|_| {})).unwrap();
    watcher.stop();
    watcher.stop();
}
