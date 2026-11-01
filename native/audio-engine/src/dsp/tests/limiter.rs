use super::*;

#[test]
fn limiter_uses_one_gain_for_the_whole_multichannel_frame() {
    let mut limiter = OutputLimiter::new();
    let original = [2.0_f32, 1.0, 0.5, -0.5, -1.0, -2.0];
    let mut samples = original;

    limiter.process(&mut samples, 6, None);

    let gain = samples[0] / original[0];
    for (actual, input) in samples.iter().zip(original) {
        assert!((actual / input - gain).abs() < 1e-6);
    }
    assert!(samples.iter().all(|sample| sample.abs() <= OUTPUT_CEILING));
}

/// 强峰与释放阶段仍能完整移除人声，不因主路限幅留下反相残响
#[test]
fn limiter_preserves_stem_cancellation_through_attack_and_release() {
    let mut limiter = OutputLimiter::new();
    let mut mix = vec![2.0_f32, -1.5, 0.1, -0.2, 1.96, -1.96, 0.0, 0.0];
    let mut stems = [vec![0.0; mix.len()], vec![0.0; mix.len()], mix.clone()];
    limiter.process(&mut mix, 2, Some(&mut stems));
    for (sample, vocal) in mix.iter().zip(&stems[2]) {
        assert!((sample - vocal).abs() < 1e-6);
        assert!(sample.abs() <= OUTPUT_CEILING + 1e-6);
    }
}
