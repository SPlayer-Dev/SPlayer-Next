use super::*;

#[test]
fn drops_gain_before_loud_transient_clips() {
    let mut analyzer = LoudnessAnalyzer::new(48000, 2);

    let initial_quiet = vec![0.04; 4800 * 2];
    for _ in 0..3 {
        analyzer.process(&initial_quiet);
    }
    let normal_quiet = vec![0.04; 19200 * 2];
    analyzer.process(&normal_quiet);

    let loud = vec![0.8; 960 * 2];
    let gain = analyzer.process(&loud);

    assert!(gain * 0.8 <= 0.95);
}
