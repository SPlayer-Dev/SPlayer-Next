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

#[test]
fn completed_handoff_releases_retired_pcm_and_active_slot_on_drop() {
    let first = buffered(vec![0.5; 100]);
    let second = buffered(vec![0.4; 100]);
    let first_weak = Arc::downgrade(&first);
    let second_weak = Arc::downgrade(&second);
    let mut source = TransitionSource::new(first, Arc::new(FftAnalyzer::new()));
    let control = source.control();
    let signals = control.queue(second, plan(0, 10, 0.04, 4)).unwrap();
    source.begin_callback();
    for _ in 0..20 {
        source.next();
    }
    assert!(signals.completed.load(Ordering::Acquire));
    assert!(first_weak.upgrade().is_some());
    control.drain_retired();
    assert!(first_weak.upgrade().is_none());
    assert!(second_weak.upgrade().is_some());
    drop(source);
    drop(control);
    assert!(second_weak.upgrade().is_none());
}

#[test]
fn cancelling_queued_or_active_handoff_releases_both_slots() {
    for start in [false, true] {
        let first = buffered(vec![0.5; 100]);
        let second = buffered(vec![0.4; 100]);
        let first_weak = Arc::downgrade(&first);
        let second_weak = Arc::downgrade(&second);
        let mut source = TransitionSource::new(first, Arc::new(FftAnalyzer::new()));
        let control = source.control();
        control.queue(second, plan(0, 50, 0.04, 4)).unwrap();
        if start {
            source.begin_callback();
            source.next();
        }
        drop(source);
        drop(control);
        assert!(first_weak.upgrade().is_none());
        assert!(second_weak.upgrade().is_none());
    }
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

fn plan(
    latest_sample: u64,
    fade_samples: u64,
    quiet_threshold: f32,
    windows: u8,
) -> TransitionPlan {
    TransitionPlan {
        earliest_sample: 0,
        latest_sample,
        fade_samples,
        quiet_threshold,
        quiet_windows_required: windows,
    }
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
        .queue(second, plan(100, 100, 0.025, 3))
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
        .queue(second, plan(400, 100, 0.025, 3))
        .expect("应接受备用槽位");
    source.begin_callback();

    let output: Vec<f32> = (0..350).map(|_| source.next().unwrap()).collect();
    assert!(output[230] > 0.0);
    assert!(output[330] > 0.49);
    assert!(signals.started.load(Ordering::Acquire));
    assert!(signals.completed.load(Ordering::Acquire));
}

#[test]
fn quiet_preference_changes_handoff_before_forced_boundary() {
    let mut first_samples = vec![0.6; 30];
    first_samples.extend(vec![0.04; 500]);
    for (threshold, windows, expected_started) in
        [(0.012, 4, false), (0.025, 3, false), (0.06, 2, true)]
    {
        let first = buffered(first_samples.clone());
        let second = buffered(vec![0.5; 500]);
        let fft = Arc::new(FftAnalyzer::new());
        let mut source = TransitionSource::new(first, Arc::clone(&fft));
        let signals = source
            .control()
            .queue(second, plan(400, 100, threshold, windows))
            .expect("应接受备用槽位");
        source.begin_callback();
        for _ in 0..300 {
            source.next();
        }
        assert_eq!(signals.started.load(Ordering::Acquire), expected_started);
        if expected_started {
            assert_eq!(signals.decision.load(Ordering::Acquire), 1);
        }
    }
}

#[test]
fn standard_fades_before_digital_silence() {
    let mut first_samples = vec![0.6; 30];
    first_samples.extend(vec![0.02; 500]);
    for index in (80..530).step_by(50) {
        first_samples[index] = 0.1;
    }
    let first = buffered(first_samples);
    let second = buffered(vec![0.5; 500]);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let signals = source
        .control()
        .queue(second, plan(400, 100, 0.025, 3))
        .expect("应接受备用槽位");
    source.begin_callback();
    for _ in 0..250 {
        source.next();
    }
    assert!(signals.started.load(Ordering::Acquire));
    assert_eq!(signals.decision.load(Ordering::Acquire), 1);
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
        .queue(second, plan(100, 200, 0.025, 3))
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

#[test]
fn handoff_position_includes_only_skipped_intro_and_played_audio() {
    let first = buffered(vec![0.6; 1000]);
    let mut samples = vec![0.0; 40];
    samples.extend(vec![0.5; 1000]);
    let second = buffered(samples);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let signals = source
        .control()
        .queue(Arc::clone(&second), plan(100, 100, 0.025, 3))
        .unwrap();
    source.begin_callback();
    for _ in 0..500 {
        source.next();
        if signals.completed.load(Ordering::Acquire) {
            break;
        }
    }
    assert!(signals.completed.load(Ordering::Acquire));
    assert!((second.consumed_position() - 0.140).abs() < 0.001);
}

#[test]
fn underrun_keeps_outgoing_gain_and_resumes_the_envelope() {
    let first = buffered(vec![0.6; 1000]);
    let second = Shared::new(1000, 1);
    second.push_output(AudioChunk {
        player_samples: vec![0.4; 60],
        fft_samples: vec![],
        source_sample_count: 60,
    });
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let signals = source
        .control()
        .queue(Arc::clone(&second), plan(0, 100, 0.025, 3))
        .unwrap();
    source.begin_callback();
    for _ in 0..60 {
        source.next();
    }
    let expected = 0.6 * (0.59 * FRAC_PI_2).cos();
    for _ in 0..20 {
        assert!((source.next().unwrap() - expected).abs() < 0.0001);
    }
    assert!(!signals.completed.load(Ordering::Acquire));
    second.push_output(AudioChunk {
        player_samples: vec![0.4; 200],
        fft_samples: vec![],
        source_sample_count: 200,
    });
    second.mark_output_eof();
    source.begin_callback();
    for _ in 0..40 {
        source.next();
    }
    assert!(signals.completed.load(Ordering::Acquire));
}

#[test]
fn outgoing_eof_does_not_jump_incoming_gain_to_full_volume() {
    let first = buffered(vec![0.6; 50]);
    let second = buffered(vec![0.4; 500]);
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    let signals = source
        .control()
        .queue(second, plan(0, 100, 0.025, 3))
        .unwrap();
    source.begin_callback();
    for _ in 0..50 {
        source.next();
    }
    assert!((source.next().unwrap() - 0.4 * FRAC_PI_2.sin() / 2.0_f32.sqrt()).abs() < 0.0001);
    assert!(!signals.completed.load(Ordering::Acquire));
}

#[test]
fn fft_observes_the_mixed_output_instead_of_each_deck() {
    let first = stereo_buffered(vec![0.5; 5000]);
    let second = stereo_buffered(vec![-0.5; 5000]);
    let fft = Arc::new(FftAnalyzer::new());
    fft.set_enabled(true);
    let reference = FftAnalyzer::new();
    reference.set_enabled(true);
    reference.set_sample_rate(1000);
    let mut source = TransitionSource::new(first, Arc::clone(&fft));
    source
        .control()
        .queue(second, plan(0, 4000, 0.025, 3))
        .unwrap();
    source.begin_callback();
    let output: Vec<_> = (0..4096).map(|_| source.next().unwrap()).collect();
    source.begin_callback();
    reference.push_interleaved_samples(&output);
    assert_eq!(fft.analyze(), reference.analyze());
}

#[test]
fn changing_speed_preserves_gain_and_scales_remaining_fade() {
    let fft = Arc::new(FftAnalyzer::new());
    let mut source = TransitionSource::new(buffered(vec![0.6; 1000]), fft);
    let control = source.control();
    let signals = control
        .queue(buffered(vec![0.4; 1000]), plan(0, 100, 0.025, 3))
        .unwrap();
    source.begin_callback();
    for _ in 0..50 {
        source.next();
    }
    control.set_speed_ratio(2.0);
    source.begin_callback();
    assert!((source.next().unwrap() - 1.0 / 2.0_f32.sqrt()).abs() < 0.0001);
    for _ in 0..24 {
        source.next();
    }
    assert!(signals.completed.load(Ordering::Acquire));
}
