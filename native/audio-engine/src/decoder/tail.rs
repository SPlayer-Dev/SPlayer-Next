use std::time::{Duration, Instant};

use anyhow::Result;
use ffmpeg_audio::{AudioError, AudioReader, ResampleOptions, SeekMode};

/// 只裁定连续近静音拖尾；未找到清晰的有声边界时保留原始结束位置。
/// @param source - 本地音源路径
/// @param start - 当前曲目或 CUE 分轨起点，单位为秒
/// @param end - 当前曲目或 CUE 分轨终点，单位为秒
/// @param cancelled - 当前播放代次是否已失效
/// @returns 确认的交接终点，无法确认时为空
pub(crate) fn analyze_tail(
    source: &str,
    start: f64,
    end: f64,
    cancelled: impl Fn() -> bool,
) -> Result<Option<f64>> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end - start < 2.5 || cancelled() {
        return Ok(None);
    }
    let began = Instant::now();
    let scan_start = start.max(end - 30.0);
    let mut reader = AudioReader::new(std::fs::File::open(source)?)?;
    let rate = f64::from(reader.source_info().sample_rate);
    let channels = reader.source_info().channels as usize;
    if rate <= 0.0 || channels == 0 || cancelled() {
        return Ok(None);
    }
    reader.seek(Duration::from_secs_f64(scan_start), SeekMode::Accurate)?;
    let mut converter = reader.build_resampler(
        ResampleOptions::new()
            .sample_rate(reader.source_info().sample_rate)
            .channels(reader.source_info().channels),
    )?;
    let mut last_audible = None;
    let mut peak = 0.0_f32;
    let mut decoded_end = scan_start;
    loop {
        if cancelled() || began.elapsed() > Duration::from_secs(1) {
            return Ok(None);
        }
        let frame = match reader.receive_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) | Err(AudioError::Eof) => break,
            Err(error) => return Err(error.into()),
        };
        let Some(timestamp) = frame.pts() else {
            return Ok(None);
        };
        let frame_start = timestamp.as_secs_f64();
        converter.process::<f32>(Some(&frame))?;
        for (index, samples) in converter
            .output_as::<f32>()
            .chunks_exact(channels)
            .enumerate()
        {
            let position = frame_start + index as f64 / rate;
            if position < scan_start || position >= end {
                continue;
            }
            if samples.iter().any(|sample| !sample.is_finite()) {
                return Ok(None);
            }
            let amplitude = samples
                .iter()
                .fold(0.0_f32, |value, sample| value.max(sample.abs()));
            peak = peak.max(amplitude);
            if amplitude > 0.001 {
                last_audible = Some(position + 1.0 / rate);
            }
        }
        decoded_end = frame_start + frame.duration().as_secs_f64();
        if decoded_end >= end {
            break;
        }
    }
    let Some(last_audible) = last_audible else {
        return Ok(None);
    };
    // 必须读到片段结尾且见过明显有声内容，避免误裁安静的整首录音或解码失败。
    if decoded_end < end - 0.1 || peak < 0.008 || end - last_audible < 2.0 {
        return Ok(None);
    }
    Ok(Some((last_audible + 0.25).min(end)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 使用反相双声道验证逐声道检测不会把有声内容抵消成静音。
    fn fixture(name: &str, seconds: u32, sample: impl Fn(f64) -> f32) -> std::path::PathBuf {
        let rate = 24_000_u32;
        let size = seconds * rate * 4;
        let mut wav = Vec::with_capacity(size as usize + 44);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(size + 36).to_le_bytes());
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
        for index in 0..seconds * rate {
            let amplitude = (sample(f64::from(index) / f64::from(rate)) * 32767.0) as i16;
            wav.extend_from_slice(&amplitude.to_le_bytes());
            wav.extend_from_slice(&(-amplitude).to_le_bytes());
        }
        let file =
            std::env::temp_dir().join(format!("splayer-tail-{}-{name}.wav", std::process::id()));
        std::fs::write(&file, wav).unwrap();
        file
    }

    #[test]
    fn detects_long_silence_and_keeps_tail_padding() {
        let file = fixture("long", 40, |time| if time < 25.0 { 0.1 } else { 0.0 });
        let began = Instant::now();
        let end = analyze_tail(file.to_str().unwrap(), 0.0, 40.0, || false)
            .unwrap()
            .unwrap();
        assert!((end - 25.25).abs() < 0.01, "{end}");
        eprintln!("30 秒曲尾扫描耗时：{:?}", began.elapsed());
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn ignores_a_quiet_passage_when_music_returns() {
        let file = fixture("returns", 20, |time| {
            if time < 5.0 || time > 18.0 {
                0.1
            } else {
                0.0
            }
        });
        assert_eq!(
            analyze_tail(file.to_str().unwrap(), 0.0, 20.0, || false).unwrap(),
            None
        );
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn respects_cue_boundaries_and_very_low_noise() {
        let file = fixture("cue", 30, |time| {
            if time < 4.0 || (10.0..12.0).contains(&time) || time > 26.0 {
                0.1
            } else {
                0.0003
            }
        });
        let end = analyze_tail(file.to_str().unwrap(), 8.0, 25.0, || false)
            .unwrap()
            .unwrap();
        assert!((end - 12.25).abs() < 0.01, "{end}");
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn preserves_quiet_recordings_and_short_silence() {
        for (name, amplitude, boundary) in [
            ("quiet", 0.0003, 2.0),
            ("short", 0.1, 4.5),
            ("silent", 0.0, 6.0),
        ] {
            let file = fixture(
                name,
                6,
                |time| if time < boundary { amplitude } else { 0.0 },
            );
            assert_eq!(
                analyze_tail(file.to_str().unwrap(), 0.0, 6.0, || false).unwrap(),
                None
            );
            std::fs::remove_file(file).unwrap();
        }
    }

    #[test]
    fn cancellation_does_not_open_the_source() {
        assert_eq!(
            analyze_tail("missing.wav", 0.0, 20.0, || true).unwrap(),
            None
        );
    }
}
