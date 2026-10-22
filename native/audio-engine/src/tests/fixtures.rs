/// 用已知频率和时长验证重采样，避免仅检查元数据中的采样率。
pub(super) fn tone_file(rate: u32, suffix: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "splayer-rate-{}-{rate}-{suffix}.wav",
        std::process::id()
    ));
    let size = rate * 4;
    let mut wav = Vec::with_capacity(44 + size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 4).to_le_bytes());
    wav.extend_from_slice(&4_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&size.to_le_bytes());
    for frame in 0..rate {
        let phase = f64::from(frame) * 1000.0 * std::f64::consts::TAU / f64::from(rate);
        let sample = (phase.sin() * 8192.0).round() as i16;
        wav.extend_from_slice(&sample.to_le_bytes());
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(&path, wav).unwrap();
    path
}
