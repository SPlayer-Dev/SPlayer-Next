use crate::dsp::tempo::StretchProcessor;

#[test]
fn automix_preroll_preserves_pulse_positions_and_every_source_sample() {
    let sample_rate = 48_000;
    let mut tempo = StretchProcessor::new(1, sample_rate);
    tempo.set_automix_rate(1.04);
    let input: Vec<f32> = (0..sample_rate * 4)
        .map(|index| {
            let phase = (index + sample_rate / 10) % (sample_rate / 2);
            if phase < sample_rate / 50 {
                (std::f32::consts::TAU * index as f32 * 1000.0 / sample_rate as f32).sin() * 0.5
            } else {
                0.0
            }
        })
        .collect();
    let mut output = Vec::new();
    let mut consumed = 0;
    for chunk in input.chunks(1024) {
        consumed += tempo.process(chunk, &mut output);
    }
    consumed += tempo.flush_automix(&mut output);
    assert_eq!(consumed, input.len() as u64);
    assert!((output.len() as f64 - input.len() as f64 / 1.04).abs() <= 2.0);
    assert_eq!(tempo.speed(), 1.0);
    for beat in 1..7 {
        let expected = ((beat as f64 * 0.5 - 0.1 + 0.01) * sample_rate as f64 / 1.04) as usize;
        let before: f32 = output[expected - 700..expected - 500]
            .iter()
            .map(|sample| sample * sample)
            .sum();
        let at: f32 = output[expected - 100..expected + 100]
            .iter()
            .map(|sample| sample * sample)
            .sum();
        assert!(
            at > before * 4.0 && at > 1.0,
            "beat={beat}, at={at}, before={before}"
        );
    }
}

#[test]
fn leaving_automix_flushes_pending_source_before_normal_playback() {
    let mut tempo = StretchProcessor::new(2, 48_000);
    tempo.set_automix_rate(0.97);
    let input = vec![0.05; 48_000];
    let mut output = Vec::new();
    let mut consumed = 0;
    for chunk in input.chunks(1024) {
        consumed += tempo.process(chunk, &mut output);
    }
    tempo.set_automix_rate(1.0);
    let normal = vec![0.1; 2048];
    consumed += tempo.process(&normal, &mut output);
    assert_eq!(consumed, (input.len() + normal.len()) as u64);
    assert_eq!(&output[output.len() - normal.len()..], normal.as_slice());
    assert!(tempo.is_bypass());
}
