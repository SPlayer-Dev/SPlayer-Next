use super::*;
use crate::decoder::buffer::AudioChunk;

fn buffered(samples: Vec<f32>) -> Arc<Shared> {
    let shared = Shared::new(1_000, 1);
    let count = samples.len() as u64;
    shared.push_output(AudioChunk {
        player_samples: samples,
        fft_samples: Vec::new(),
        source_sample_count: count,
    });
    shared.mark_output_eof();
    shared
}

fn stereo_buffered(samples: Vec<f32>) -> Arc<Shared> {
    let shared = Shared::new(1_000, 2);
    let count = samples.len() as u64;
    shared.push_output(AudioChunk {
        player_samples: samples,
        fft_samples: Vec::new(),
        source_sample_count: count,
    });
    shared.mark_output_eof();
    shared
}

#[test]
fn crossfade_keeps_one_output_source_and_skips_quiet_intro() {
    let first = buffered(vec![0.6; 500]);
    let mut second_samples = vec![0.0; 40];
    second_samples.extend(vec![0.5; 500]);
    let second = buffered(second_samples);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let control = source.control();
    let signals = control
        .queue(second, fft, 0, 100, 100, 0.005)
        .expect("应接受备用槽位");
    source.begin_callback();

    let mut output: Vec<f32> = (0..90).map(|_| source.next().unwrap()).collect();
    assert!(!signals.started.load(Ordering::Acquire));
    output.extend((90..240).map(|_| source.next().unwrap()));
    assert!(output[..90]
        .iter()
        .all(|sample| (*sample - 0.6).abs() < 0.001));
    assert!(output[145] > 0.5 && output[145] < 0.8);
    assert!(output[220..]
        .iter()
        .all(|sample| (*sample - 0.5).abs() < 0.001));
    assert!(signals.started.load(Ordering::Acquire));
    assert!(signals.completed.load(Ordering::Acquire));
    control.drain_retired();
}

#[test]
fn quiet_outro_starts_before_forced_boundary() {
    let mut first_samples = vec![0.6; 30];
    first_samples.extend(vec![0.0; 500]);
    let first = buffered(first_samples);
    let second = buffered(vec![0.5; 500]);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let signals = source
        .control()
        .queue(second, fft, 0, 400, 100, 0.005)
        .expect("应接受备用槽位");
    source.begin_callback();

    let output: Vec<f32> = (0..350).map(|_| source.next().unwrap()).collect();
    assert!(output[230] > 0.0);
    assert!(output[330] > 0.49);
    assert!(signals.started.load(Ordering::Acquire));
    assert!(signals.completed.load(Ordering::Acquire));
}

#[test]
fn quiet_preference_changes_handoff_without_changing_fade_length() {
    let mut first_samples = vec![0.6; 30];
    first_samples.extend(vec![0.01; 500]);
    for (threshold, expected_started) in [(0.0025, false), (0.005, false), (0.015, true)] {
        let first = buffered(first_samples.clone());
        let second = buffered(vec![0.5; 500]);
        let fft = Arc::new(FftAnalyzer::new());
        let mut source = TransitionSource::new(first, Arc::clone(&fft));
        let signals = source
            .control()
            .queue(second, fft, 0, 400, 100, threshold)
            .expect("应接受备用槽位");
        source.begin_callback();
        for _ in 0..300 {
            source.next();
        }
        assert_eq!(signals.started.load(Ordering::Acquire), expected_started);
    }
}

#[test]
fn skipped_stereo_intro_preserves_channel_order() {
    let first = stereo_buffered(vec![0.6; 1_000]);
    let mut next_samples = vec![0.0; 80];
    for _ in 0..500 {
        next_samples.extend([0.2, 0.8]);
    }
    let second = stereo_buffered(next_samples);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    source
        .control()
        .queue(second, fft, 0, 100, 200, 0.005)
        .expect("应接受双声道备用槽位");
    source.begin_callback();
    let output: Vec<f32> = (0..400).map(|_| source.next().unwrap()).collect();
    for index in (320..output.len()).step_by(2) {
        assert!((output[index] - 0.2).abs() < 0.001);
        assert!((output[index + 1] - 0.8).abs() < 0.001);
    }
}

#[test]
fn mixed_peak_has_a_smooth_ceiling() {
    assert_eq!(soft_ceiling(0.8), 0.8);
    assert!(soft_ceiling(1.3) < 1.0);
    assert!(soft_ceiling(1.3) > soft_ceiling(1.0));
    assert_eq!(soft_ceiling(-1.3), -soft_ceiling(1.3));
}
