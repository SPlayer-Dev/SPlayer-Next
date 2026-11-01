use super::*;

#[test]
fn defaults_are_bypass() {
    let p = StretchProcessor::new(2, 48000);
    assert!(p.is_bypass());
}

#[test]
fn sync_on_pitch_only_changes_transpose() {
    let mut p = StretchProcessor::new(2, 48000);
    p.set_pitch(5);
    assert!(!p.is_bypass());
    assert!((p.effective_transpose() - 5.0).abs() < 1e-6);
}

#[test]
fn sync_off_speed_drives_transpose() {
    let mut p = StretchProcessor::new(2, 48000);
    p.set_pitch_sync(false);
    p.set_speed(2.0);
    // speed=2 → transpose ≈ 12 半音（升 1 个八度）
    assert!((p.effective_transpose() - 12.0).abs() < 1e-3);
}

#[test]
fn bypass_passthrough_preserves_samples() {
    let mut p = StretchProcessor::new(2, 48000);
    let input = vec![0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
    let mut output = Vec::new();
    p.process(&input, &mut output);
    assert_eq!(output, input);
}

#[test]
fn rebuilds_for_multichannel_output() {
    let mut p = StretchProcessor::new(2, 48_000);
    p.set_output_format(96_000, 6);

    assert_eq!(p.channels, 6);
    assert_eq!(p.sample_rate, 96_000);
}
