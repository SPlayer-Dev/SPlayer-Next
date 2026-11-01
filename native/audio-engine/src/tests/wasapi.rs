use std::io::{Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;

use crate::decoder::{prepare_decode, start_prepared_decode};
use crate::dsp::equalizer::Equalizer;
use crate::dsp::fft::FftAnalyzer;
use crate::dsp::tempo::StretchProcessor;
use crate::output::playback::PlaybackHandle;
use crate::output::{AudioOutput, ExclusiveFallbackCallback};

use super::fixtures::tone_file;

#[test]
#[ignore = "需要可独占的 Windows 音频设备；每个采样率施加 10 秒全核 CPU 负载"]
fn wasapi_exclusive_progresses_under_cpu_load() {
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
    let workers = std::thread::available_parallelism().unwrap().get();

    for rate in [48_000, 192_000] {
        let errors = Arc::new(AtomicUsize::new(0));
        let failures = Arc::clone(&errors);
        let fallbacks = Arc::clone(&errors);
        let on_fallback: ExclusiveFallbackCallback = Arc::new(move |_| {
            fallbacks.fetch_add(1, Ordering::Relaxed);
        });
        let output = AudioOutput::new(
            None,
            Some(rate),
            Some(16),
            1,
            Arc::new(move || {
                failures.fetch_add(1, Ordering::Relaxed);
            }),
            Some(&on_fallback),
        )
        .unwrap();
        let fft = Arc::new(FftAnalyzer::new());
        fft.set_enabled(true);
        let (output, shared, playback) = PlaybackHandle::prepare(output, fft).unwrap();
        assert_eq!(errors.load(Ordering::Relaxed), 0, "测试要求实际独占输出");

        let path = tone_file(rate, "wasapi-load");
        // 延长 fixture 的 PCM 数据区，负载期间不会遇到自然结束；输出音量为零。
        let data_size = rate * 4 * 30;
        let mut file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(u64::from(44 + data_size)).unwrap();
        file.seek(SeekFrom::Start(4)).unwrap();
        file.write_all(&(36 + data_size).to_le_bytes()).unwrap();
        file.seek(SeekFrom::Start(40)).unwrap();
        file.write_all(&data_size.to_le_bytes()).unwrap();
        drop(file);

        let prepared =
            prepare_decode(path.to_str().unwrap(), None, HttpCancelHandle::new()).unwrap();
        let (_, decoder, _) = start_prepared_decode(
            prepared,
            Arc::clone(&shared),
            Arc::new(Mutex::new(Equalizer::new(
                output.sample_rate(),
                output.channels(),
            ))),
            Arc::new(Mutex::new(StretchProcessor::new(
                output.channels(),
                output.sample_rate(),
            ))),
        )
        .unwrap();
        let started = playback.activate(0.0, false);
        if let Err(error) = started {
            shared.stop();
            decoder.join().unwrap();
            std::fs::remove_file(path).unwrap();
            panic!("启动独占输出失败：{error}");
        }
        std::thread::sleep(Duration::from_millis(250));

        let barrier = Barrier::new(workers + 1);
        let (elapsed, advanced) = std::thread::scope(|scope| {
            for _ in 0..workers {
                let barrier = &barrier;
                scope.spawn(move || {
                    let mut memory = vec![0u32; 1024 * 1024];
                    barrier.wait();
                    let until = Instant::now() + Duration::from_secs(10);
                    let mut value = 1u32;
                    while Instant::now() < until {
                        for item in &mut memory {
                            value = (value ^ *item)
                                .wrapping_mul(1664525)
                                .wrapping_add(1013904223);
                            *item = value;
                        }
                        std::hint::black_box(&memory);
                    }
                });
            }
            let initial = shared.consumed_position();
            let start = Instant::now();
            barrier.wait();
            std::thread::sleep(Duration::from_secs(10));
            (
                start.elapsed().as_secs_f64(),
                shared.consumed_position() - initial,
            )
        });
        playback.stop();
        shared.stop();
        decoder.join().unwrap();
        std::fs::remove_file(path).unwrap();

        eprintln!(
            "rate={rate} output_rate={} workers={workers} elapsed={elapsed:.3} advanced={advanced:.3}",
            output.sample_rate()
        );
        assert_eq!(errors.load(Ordering::Relaxed), 0, "独占输出发生错误或回退");
        assert_eq!(shared.take_underruns(), 0, "负载期间供数不足");
        assert!(
            (advanced - elapsed).abs() < 0.35,
            "高负载下播放进度偏离墙钟"
        );
    }
}
