use super::*;

#[test]
fn processes_every_output_channel_independently() {
    let mut equalizer = Equalizer::new(48_000, 6);
    equalizer.set_enabled(true);
    equalizer.set_preamp_db(6.0);
    let mut samples = vec![0.1, -0.2, 0.3, -0.4, 0.5, -0.6];

    equalizer.process_interleaved(&mut samples);

    for (actual, original) in samples.iter().zip([0.1_f32, -0.2, 0.3, -0.4, 0.5, -0.6]) {
        assert!(actual.abs() > original.abs());
    }
}

#[test]
fn rebuilds_filters_when_output_channel_count_changes() {
    let mut equalizer = Equalizer::new(48_000, 2);
    equalizer.set_output_format(96_000, 8);

    assert_eq!(equalizer.filters.len(), 8);
    assert_eq!(equalizer.sample_rate, 96_000.0);
}
