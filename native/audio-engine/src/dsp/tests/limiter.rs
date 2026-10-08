use super::*;

#[test]
fn limiter_uses_one_gain_for_the_whole_multichannel_frame() {
    let mut limiter = OutputLimiter::new();
    let original = [2.0_f32, 1.0, 0.5, -0.5, -1.0, -2.0];
    let mut samples = original;

    limiter.process(&mut samples, 6);

    let gain = samples[0] / original[0];
    for (actual, input) in samples.iter().zip(original) {
        assert!((actual / input - gain).abs() < 1e-6);
    }
    assert!(samples.iter().all(|sample| sample.abs() <= OUTPUT_CEILING));
}
