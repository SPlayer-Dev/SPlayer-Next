use super::*;

#[test]
fn dsp_applies_equalizer_and_limiter_before_output() {
    let equalizer = Mutex::new(Equalizer::new(48_000, 2));
    equalizer.lock().set_enabled(true);
    equalizer.lock().set_preamp_db(12.0);
    let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
    let mut limiter = OutputLimiter::new();
    let mut scratch = Vec::new();

    let processed = process_audio_chunk(
        AudioChunk {
            player_samples: vec![0.8, -0.8],
            fft_samples: Vec::new(),
            source_sample_count: 2,
        },
        &equalizer,
        &tempo,
        &mut limiter,
        &mut scratch,
        2,
        false,
    );

    assert!(processed
        .player_samples
        .iter()
        .all(|sample| sample.abs() <= 0.98 + 1e-6));
}

#[test]
fn passthrough_preserves_full_scale_samples_without_limiter() {
    let equalizer = Mutex::new(Equalizer::new(48_000, 2));
    let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
    let mut limiter = OutputLimiter::new();
    let mut scratch = Vec::new();

    let input = vec![1.0, -1.0, 0.99, -0.99];
    let processed = process_audio_chunk(
        AudioChunk {
            player_samples: input.clone(),
            fft_samples: Vec::new(),
            source_sample_count: 4,
        },
        &equalizer,
        &tempo,
        &mut limiter,
        &mut scratch,
        2,
        false,
    );

    // 直通路径未开启任何音效，满幅样本原样透传，不被压至 0.98
    assert_eq!(processed.player_samples, input);
}

#[test]
fn tempo_changes_output_length_but_preserves_source_count() {
    let equalizer = Mutex::new(Equalizer::new(48_000, 2));
    let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
    tempo.lock().set_speed(2.0);
    let mut limiter = OutputLimiter::new();
    let mut scratch = Vec::new();
    let input = vec![0.1; 4096];

    let processed = process_audio_chunk(
        AudioChunk {
            source_sample_count: input.len() as u64,
            player_samples: input,
            fft_samples: Vec::new(),
        },
        &equalizer,
        &tempo,
        &mut limiter,
        &mut scratch,
        2,
        false,
    );

    assert_eq!(processed.source_sample_count, 4096);
    assert_eq!(processed.player_samples.len(), 2048);
}
