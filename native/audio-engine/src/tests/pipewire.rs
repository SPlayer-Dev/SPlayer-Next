use std::sync::Arc;
use std::time::{Duration, Instant};

use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;

use crate::decoder::{prepare_decode, start_prepared_decode};
use crate::dsp::equalizer::Equalizer;

use crate::dsp::tempo::StretchProcessor;

use super::fixtures::tone_file;

#[test]
#[ignore = "需要 scripts/test-pipewire.sh 创建的隔离 PipeWire 服务"]
fn pipewire_real_output_rate_matrix() {
    use crate::dsp::fft::FftAnalyzer;
    use crate::output::playback::PlaybackHandle;
    use crate::output::AudioOutput;
    use std::sync::atomic::{AtomicUsize, Ordering};

    assert_eq!(cpal::default_host().id(), cpal::HostId::PipeWire);
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
    for rate in [44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800] {
        let failures = Arc::new(AtomicUsize::new(0));
        let errors = Arc::clone(&failures);
        let output = AudioOutput::new(
            None,
            Some(rate),
            Some(16),
            1,
            Arc::new(move || {
                errors.fetch_add(1, Ordering::Relaxed);
            }),
            None,
        )
        .unwrap();
        let (output, shared, playback) =
            PlaybackHandle::prepare(output, Arc::new(FftAnalyzer::new())).unwrap();
        assert_eq!(output.sample_rate(), rate, "未使用测试要求的流采样率");
        let path = tone_file(rate, "pipewire");
        let prepared =
            prepare_decode(path.to_str().unwrap(), None, HttpCancelHandle::new()).unwrap();
        let (_, worker, _) = start_prepared_decode(
            prepared,
            Arc::clone(&shared),
            Arc::new(Mutex::new(Equalizer::new(rate, 2))),
            Arc::new(Mutex::new(StretchProcessor::new(2, rate))),
        )
        .unwrap();
        let start = Instant::now();
        playback.activate(1.0, false).unwrap();
        while !shared.is_all_consumed() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(5));
        }
        playback.pause();
        shared.stop();
        worker.join().unwrap();
        std::fs::remove_file(path).unwrap();
        assert!(shared.is_all_consumed(), "输出停滞: {rate}");
        assert_eq!(failures.load(Ordering::Relaxed), 0, "输出重建: {rate}");
        assert!((shared.consumed_position() - 1.0).abs() < 0.001);
        assert!(
            (start.elapsed().as_secs_f64() - 1.0).abs() < 0.35,
            "播放速度错误: {rate}"
        );
        let underruns = shared.take_underruns();
        println!(
            "rate={rate} elapsed={:?} source_underruns={underruns}",
            start.elapsed()
        );
        assert_eq!(underruns, 0, "正常负载发生供数欠载: {rate}");
    }
}
