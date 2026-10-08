use std::sync::Arc;
use std::time::{Duration, Instant};

use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;

use crate::decoder::buffer::{PopResult, Shared};
use crate::decoder::{prepare_decode, start_prepared_decode};
use crate::dsp::equalizer::Equalizer;
use crate::dsp::tempo::StretchProcessor;

use super::fixtures::tone_file;

#[test]
fn real_decoder_preserves_duration_and_pitch_across_output_rates() {
    for (input, output) in [
        (44_100, 48_000),
        (48_000, 44_100),
        (96_000, 96_000),
        (192_000, 48_000),
        (192_000, 192_000),
        (352_800, 48_000),
        (352_800, 352_800),
    ] {
        let path = tone_file(input, &output.to_string());
        let prepared =
            prepare_decode(path.to_str().unwrap(), None, HttpCancelHandle::new()).unwrap();
        let shared = Shared::new(output, 2);
        let (_, worker, _) = start_prepared_decode(
            prepared,
            Arc::clone(&shared),
            Arc::new(Mutex::new(Equalizer::new(output, 2))),
            Arc::new(Mutex::new(StretchProcessor::new(2, output))),
        )
        .unwrap();
        let mut samples = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(Instant::now() < deadline, "解码超时: {input} -> {output}");
            match shared.try_pop() {
                PopResult::Chunk(chunk) => samples.extend(chunk.player_samples),
                PopResult::Pending => std::thread::sleep(Duration::from_millis(1)),
                PopResult::Finished => break,
            }
        }
        let mut decoder = worker.join().unwrap();
        std::fs::remove_file(path).unwrap();
        if input == 192_000 && output == 192_000 {
            assert!(decoder.seek(0.25));
            decoder.reconfigure_player_output(48_000, 2).unwrap();
            let resumed = Shared::new(48_000, 2);
            let worker = crate::decoder::resume_decode(
                decoder,
                Arc::clone(&resumed),
                Arc::new(Mutex::new(Equalizer::new(48_000, 2))),
                Arc::new(Mutex::new(StretchProcessor::new(2, 48_000))),
            )
            .unwrap();
            let mut count = 0;
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                assert!(Instant::now() < deadline, "seek 后输出未完成");
                match resumed.try_pop() {
                    PopResult::Chunk(chunk) => count += chunk.player_samples.len(),
                    PopResult::Pending => std::thread::sleep(Duration::from_millis(1)),
                    PopResult::Finished => break,
                }
            }
            worker.join().unwrap();
            assert!(!resumed.is_decode_failed());
            assert!(
                (count as i64 - 72_000).abs() <= 4,
                "seek/切设备后时长错误: {count}"
            );
        }
        assert!(!shared.is_decode_failed());
        assert!(
            (samples.len() as i64 - i64::from(output) * 2).abs() <= 4,
            "时长错误: {input} -> {output}"
        );
        assert!(samples.iter().all(|s| s.is_finite() && s.abs() <= 0.3));
        let crossings = samples
            .chunks_exact(2)
            .map(|frame| frame[0])
            .collect::<Vec<_>>()
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        assert!(
            (crossings as i32 - 1000).abs() <= 2,
            "音调错误: {input} -> {output}: {crossings}"
        );
    }
}
