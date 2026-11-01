use super::*;

#[test]
fn transition_updates_both_dsp_slots_and_releases_them_on_stop() {
    let mut player = InnerPlayer::new().unwrap();
    let shared = Shared::new(48000, 2);
    let equalizer = Arc::new(Mutex::new(Equalizer::new(48000, 2)));
    let tempo = Arc::new(Mutex::new(StretchProcessor::new(2, 48000)));
    player.transition_dsp = Some(crossfade::TransitionDsp {
        automix: false,
        initial_speed: 1.0,
        shared: Arc::clone(&shared),
        equalizer: Arc::clone(&equalizer),
        tempo: Arc::clone(&tempo),
    });
    player.set_speed(1.5);
    player.set_pitch(2);
    player.set_pitch_sync(false);
    player.set_equalizer_enabled(true);
    player.set_preamp_gain(-3.0);
    player.set_equalizer_bands(&[2.0; EQ_BAND_COUNT]);
    player.set_normalization_enabled(true);
    assert_eq!(tempo.lock().speed(), player.speed());
    assert_eq!(tempo.lock().pitch(), player.pitch());
    assert_eq!(tempo.lock().pitch_sync(), player.pitch_sync());
    assert!(equalizer.lock().enabled());
    assert_eq!(equalizer.lock().preamp_db(), -3.0);
    assert_eq!(equalizer.lock().band_gains_db(), [2.0; EQ_BAND_COUNT]);
    assert!(shared.is_normalization_enabled());
    player.stop();
    assert!(player.transition_dsp.is_none());
}

#[test]
fn prepared_dsp_inherits_changes_made_during_output_open() {
    let mut player = InnerPlayer::new().unwrap();
    let equalizer = Arc::new(Mutex::new(Equalizer::new(48_000, 2)));
    let tempo = Arc::new(Mutex::new(StretchProcessor::new(2, 48_000)));
    player.set_equalizer_enabled(true);
    player.set_equalizer_bands(&[2.0; EQ_BAND_COUNT]);
    player.set_preamp_gain(-3.0);
    player.set_speed(1.25);
    player.set_pitch(2);
    player.set_pitch_sync(true);
    player.replace_dsp(Arc::clone(&equalizer), Arc::clone(&tempo));
    assert!(equalizer.lock().enabled());
    assert_eq!(equalizer.lock().band_gains_db(), [2.0; EQ_BAND_COUNT]);
    assert_eq!(equalizer.lock().preamp_db(), -3.0);
    assert_eq!(tempo.lock().speed(), 1.25);
    assert_eq!(tempo.lock().pitch(), 2);
    assert!(tempo.lock().pitch_sync());
}

#[test]
fn stop_cancels_pending_preload_without_a_device() {
    let mut player = InnerPlayer::new().unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    player.preload.id = Some("pending".into());
    player.preload.cancelled = Some(Arc::clone(&cancelled));
    player.stop();
    assert!(cancelled.load(Ordering::Acquire));
    assert!(player.preload.id.is_none());
}

/// 迟到取消不影响当前代次，当前代次取消后立即释放有限声部
#[test]
fn cancelling_prepared_releases_installed_stems_for_that_generation() {
    let mut player = InnerPlayer::new().unwrap();
    let shared = Shared::new(44_100, 2);
    let path =
        std::env::temp_dir().join(format!("splayer-cancel-stems-{}.bin", std::process::id()));
    std::fs::write(&path, vec![0_u8; 88_200 * 24]).unwrap();
    let result = crate::decoder::stems::StemWindow::load(&path.to_string_lossy(), 0.0, 88_200);
    std::fs::remove_file(path).unwrap();
    let window = result.unwrap();
    let weak = Arc::downgrade(&window);
    shared.set_stems(Some(window));
    player.shared = Some(shared);
    let cancelled = Arc::new(AtomicBool::new(false));
    player.preload.id = Some("current".into());
    player.preload.cancelled = Some(Arc::clone(&cancelled));
    player.cancel_prepared("old");
    assert!(weak.upgrade().is_some());
    assert!(!cancelled.load(Ordering::Acquire));
    player.cancel_prepared("current");
    assert!(weak.upgrade().is_none());
    assert!(cancelled.load(Ordering::Acquire));
}
