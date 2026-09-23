use super::*;
use crate::decoder::buffer::AudioChunk;

#[test]
fn returns_preprocessed_samples_without_copying() {
    let shared = Shared::new(48_000, 2);
    shared.push_output(AudioChunk {
        player_samples: vec![0.1, -0.1, 2.0, -2.0],
        fft_samples: vec![],
        source_sample_count: 4,
    });

    let mut source = DecoderSource::new(shared);

    assert!((source.next().unwrap() - 0.1).abs() < 1e-6);
    assert!((source.next().unwrap() + 0.1).abs() < 1e-6);
    assert!((source.next().unwrap() - 2.0).abs() < 1e-6);
    assert!((source.next().unwrap() + 2.0).abs() < 1e-6);
}

#[test]
fn position_uses_source_sample_count_after_tempo_processing() {
    let shared = Shared::new(1000, 2);
    shared.push_output(AudioChunk {
        player_samples: vec![0.25, -0.25],
        fft_samples: vec![],
        source_sample_count: 8,
    });
    let mut source = DecoderSource::new(Arc::clone(&shared));

    assert_eq!(source.next(), Some(0.25));
    source.sync_position();
    assert!((shared.consumed_position() - 0.002).abs() < f64::EPSILON);
    assert_eq!(source.next(), Some(-0.25));
    source.sync_position();
    assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
}

#[test]
fn cue_end_stops_at_a_complete_frame_inside_a_chunk() {
    let shared = Shared::new(1000, 2);
    shared.set_end_position(0.003);
    shared.push_output(AudioChunk {
        player_samples: vec![0.25; 100],
        fft_samples: vec![],
        source_sample_count: 100,
    });
    let mut source = DecoderSource::new(Arc::clone(&shared));
    for _ in 0..6 {
        assert_eq!(source.next(), Some(0.25));
    }
    assert_eq!(source.next(), None);
    assert!(shared.is_all_consumed());
    assert_eq!(shared.samples_consumed_count(), 6);
}

#[test]
fn tempo_warmup_without_output_still_advances_source_position() {
    let shared = Shared::new(1000, 2);
    shared.push_output(AudioChunk {
        player_samples: Vec::new(),
        fft_samples: Vec::new(),
        source_sample_count: 8,
    });
    let mut source = DecoderSource::new(Arc::clone(&shared));

    assert_eq!(source.next(), Some(0.0));
    assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
}

#[test]
fn underrun_recovers_at_next_callback_without_extending_silence() {
    let shared = Shared::new(1000, 2);
    let mut source = DecoderSource::new(Arc::clone(&shared));

    assert_eq!(source.next(), Some(0.0));
    shared.push_output(AudioChunk {
        player_samples: vec![0.25, -0.25],
        fft_samples: vec![],
        source_sample_count: 2,
    });
    for _ in 0..39 {
        assert_eq!(source.next(), Some(0.0));
    }
    shared.mark_output_eof();
    source.begin_callback();
    assert_eq!(source.next(), Some(0.25));
    assert_eq!(source.next(), Some(-0.25));
}

#[test]
fn startup_waits_for_audio_but_short_track_drains_at_eof() {
    let shared = Shared::new(192_000, 2);
    let mut source = DecoderSource::new(Arc::clone(&shared));
    shared.push_output(AudioChunk {
        player_samples: vec![0.25; 2],
        fft_samples: vec![],
        source_sample_count: 2,
    });
    source.begin_callback();
    assert_eq!(source.next(), Some(0.0));
    assert_eq!(shared.samples_consumed_count(), 0);
    shared.mark_output_eof();
    source.begin_callback();
    assert_eq!(source.next(), Some(0.25));
    assert_eq!(source.next(), Some(0.25));
    assert_eq!(source.next(), None);
    assert!(shared.is_all_consumed());
    assert_eq!(shared.take_underruns(), 0);
}

#[test]
fn high_rate_underrun_does_not_delay_ready_audio_to_twenty_milliseconds() {
    for rate in [44_100, 48_000, 96_000, 192_000, 352_800] {
        let shared = Shared::new(rate, 2);
        let mut source = DecoderSource::new(Arc::clone(&shared));
        source.started = true;
        source.begin_callback();
        for _ in 0..128 {
            assert_eq!(source.next(), Some(0.0));
        }
        assert_eq!(shared.take_underruns(), 1);
        shared.push_output(AudioChunk {
            player_samples: vec![0.25, -0.25],
            fft_samples: vec![],
            source_sample_count: 2,
        });
        source.begin_callback();
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(source.next(), Some(-0.25));
    }
}
