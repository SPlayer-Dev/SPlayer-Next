use super::*;

/// 强电平人声经过均衡、变速、限幅后仍与主路完全对齐
#[test]
fn separated_voice_stays_aligned_through_eq_automix_and_flush() {
    let equalizer = Mutex::new(Equalizer::new(48_000, 2));
    equalizer.lock().set_enabled(true);
    equalizer
        .lock()
        .set_band_gains(&[1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0]);
    let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
    let mut state = DspState::new(Vec::new());
    state.stems = Some(StemProcessors::new(48_000, 2));
    for block in 0..40 {
        if block == 5 {
            tempo.lock().set_automix_rate(1.03);
        }
        let samples: Vec<f32> = (0..4096)
            .map(|index| {
                let position = (block * 4096 + index) / 2;
                (position as f32 * 0.037).sin() * 0.8
            })
            .collect();
        let processed = process_audio_chunk(
            AudioChunk {
                normalization_gain: 1.0,
                source_sample_count: samples.len() as u64,
                stem_samples: Some(Box::new([
                    vec![0.0; samples.len()],
                    vec![0.0; samples.len()],
                    samples.clone(),
                ])),
                player_samples: samples,
                fft_samples: Vec::new(),
            },
            &equalizer,
            &tempo,
            &mut state,
            2,
            false,
        );
        let voice = &processed.stem_samples.as_ref().unwrap()[2];
        assert_eq!(voice.len(), processed.player_samples.len());
        assert!(processed
            .player_samples
            .iter()
            .all(|sample| sample.abs() <= 0.980001));
        assert!(voice
            .iter()
            .zip(&processed.player_samples)
            .all(|(stem, full)| (stem - full).abs() < 1e-5));
    }
    let mut tail = Vec::new();
    tempo.lock().flush_automix(&mut tail);
    let stems = state.stems.as_mut().unwrap().flush();
    assert_eq!(tail.len(), stems[2].len());
    assert!(tail
        .iter()
        .zip(&stems[2])
        .all(|(full, stem)| (full - stem).abs() < 1e-5));
}

#[test]
fn dsp_applies_equalizer_and_limiter_before_output() {
    let equalizer = Mutex::new(Equalizer::new(48_000, 2));
    equalizer.lock().set_enabled(true);
    equalizer.lock().set_preamp_db(12.0);
    let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
    let mut state = DspState::new(Vec::new());

    let processed = process_audio_chunk(
        AudioChunk {
            normalization_gain: 1.0,
            stem_samples: None,
            player_samples: vec![0.8, -0.8],
            fft_samples: Vec::new(),
            source_sample_count: 2,
        },
        &equalizer,
        &tempo,
        &mut state,
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
    let mut state = DspState::new(Vec::new());

    let input = vec![1.0, -1.0, 0.99, -0.99];
    let processed = process_audio_chunk(
        AudioChunk {
            normalization_gain: 1.0,
            stem_samples: None,
            player_samples: input.clone(),
            fft_samples: Vec::new(),
            source_sample_count: 4,
        },
        &equalizer,
        &tempo,
        &mut state,
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
    let mut state = DspState::new(Vec::new());
    let input = vec![0.1; 4096];

    let processed = process_audio_chunk(
        AudioChunk {
            normalization_gain: 1.0,
            stem_samples: None,
            source_sample_count: input.len() as u64,
            player_samples: input,
            fft_samples: Vec::new(),
        },
        &equalizer,
        &tempo,
        &mut state,
        2,
        false,
    );

    assert_eq!(processed.source_sample_count, 4096);
    assert_eq!(processed.player_samples.len(), 2048);
}
