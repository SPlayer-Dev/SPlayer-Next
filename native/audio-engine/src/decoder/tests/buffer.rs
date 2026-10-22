use super::*;

#[test]
fn parked_standby_output_wakes_on_activation_or_cancellation() {
    for cancel in [false, true] {
        let shared = Shared::new(1000, 1);
        shared.set_preloading(true);
        shared.push_output(AudioChunk {
            player_samples: vec![0.5; 100],
            fft_samples: vec![],
            source_sample_count: 100,
        });
        let worker_shared = Arc::clone(&shared);
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            worker_shared.push_output(AudioChunk {
                player_samples: vec![0.5; 100],
                fft_samples: vec![],
                source_sample_count: 100,
            });
            send.send(()).unwrap();
        });
        assert!(receive.recv_timeout(Duration::from_millis(30)).is_err());
        if cancel {
            shared.stop();
        } else {
            shared.set_preloading(false);
            assert!(matches!(shared.try_pop(), PopResult::Chunk(_)));
        }
        receive.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
        shared.stop();
    }
}

#[test]
fn standby_decode_queue_resumes_when_promoted() {
    let shared = Shared::new(48_000, 2);
    shared.set_preloading(true);
    for _ in 0..2 {
        shared.push(AudioChunk {
            player_samples: vec![0.0; 128],
            fft_samples: vec![],
            source_sample_count: 128,
        });
    }
    let (send, receive) = std::sync::mpsc::channel();
    let worker_shared = Arc::clone(&shared);
    let worker = std::thread::spawn(move || {
        send.send(worker_shared.wait_for_space()).unwrap();
    });
    assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
    shared.set_preloading(false);
    assert!(receive.recv_timeout(Duration::from_secs(1)).unwrap());
    worker.join().unwrap();
    shared.stop();
}

#[test]
fn cancelling_standby_wakes_blocked_decoder() {
    let shared = Shared::new(48_000, 2);
    shared.set_preloading(true);
    for _ in 0..2 {
        shared.push(AudioChunk {
            player_samples: vec![0.0; 128],
            fft_samples: vec![],
            source_sample_count: 128,
        });
    }
    let worker_shared = Arc::clone(&shared);
    let worker = std::thread::spawn(move || worker_shared.wait_for_space());
    shared.stop();
    assert!(!worker.join().unwrap());
}

#[test]
fn sample_buffer_pools_are_bounded() {
    let shared = Shared::new(48_000, 2);

    for _ in 0..(BUFFER_POOL_CAPACITY + 20) {
        shared.recycle_player_buffer(Vec::with_capacity(16));
        shared.recycle_fft_buffer(Vec::with_capacity(16));
    }

    assert_eq!(shared.player_buffer_pool.len(), BUFFER_POOL_CAPACITY);
    assert_eq!(shared.fft_buffer_pool.len(), BUFFER_POOL_CAPACITY);
}
#[test]
fn high_rate_buffer_is_limited_by_duration_and_stop_unblocks_producer() {
    for rate in [44_100, 48_000, 96_000, 192_000, 352_800] {
        let shared = Shared::new(rate, 2);
        let samples = rate as usize * 2 / 100;
        for _ in 0..10 {
            shared.push_output(AudioChunk {
                player_samples: vec![0.25; samples],
                fft_samples: vec![],
                source_sample_count: samples as u64,
            });
        }
        assert_eq!(
            shared.output_samples.load(Ordering::Acquire),
            (samples * 10) as u64
        );
        assert!(shared.output_ready());
        let producer = Arc::clone(&shared);
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            producer.push_output(AudioChunk {
                player_samples: vec![0.5; samples],
                fft_samples: vec![],
                source_sample_count: samples as u64,
            });
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(10)).is_err());
        shared.stop();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
        shared.drain_buffer();
        assert!(shared.is_buffer_empty());
        assert_eq!(shared.output_samples.load(Ordering::Acquire), 0);
    }
}

#[test]
fn concurrent_consumer_keeps_every_sample_in_order_through_eof() {
    let shared = Shared::new(192_000, 2);
    let producer = Arc::clone(&shared);
    let worker = std::thread::spawn(move || {
        for i in 0..10_000 {
            producer.push_output(AudioChunk {
                player_samples: vec![i as f32; 32],
                fft_samples: vec![],
                source_sample_count: 32,
            });
        }
        producer.mark_output_eof();
    });
    let mut chunks = 0;
    loop {
        match shared.try_pop() {
            PopResult::Chunk(chunk) => {
                assert!(chunk.player_samples.iter().all(|s| *s == chunks as f32));
                chunks += 1;
            }
            PopResult::Pending => std::thread::yield_now(),
            PopResult::Finished => break,
        }
    }
    worker.join().unwrap();
    assert_eq!(chunks, 10_000);
    assert_eq!(shared.output_samples.load(Ordering::Acquire), 0);
}
