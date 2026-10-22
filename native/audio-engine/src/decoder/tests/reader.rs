use super::*;
use std::io::Cursor;

fn mono_wav() -> Vec<u8> {
    let sample_rate = 48_000_u32;
    let frames = 1024_u32;
    let data_size = frames * 2;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(44 + data_size as usize, 0);
    bytes
}

#[test]
fn playback_and_fft_resamplers_use_independent_channel_counts() {
    let mut reader = AudioReader::new(Cursor::new(mono_wav())).unwrap();
    assert_eq!(reader.source_info().channels, 1);
    let (mut player_resampler, mut fft_resampler) = build_resamplers(&reader, 48_000, 6).unwrap();
    let frame = reader.receive_frame().unwrap().unwrap();

    player_resampler.process::<f32>(Some(&frame)).unwrap();
    fft_resampler.process::<f32>(Some(&frame)).unwrap();

    let player_samples = player_resampler.output_as::<f32>();
    let fft_samples = fft_resampler.output_as::<f32>();
    assert!(!player_samples.is_empty());
    assert!(!fft_samples.is_empty());
    assert_eq!(player_samples.len() % 6, 0);
    assert_eq!(fft_samples.len() % usize::from(FFT_CHANNELS), 0);
}
