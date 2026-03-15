use std::collections::VecDeque;
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result};
use parking_lot::{Condvar, Mutex};

/// A chunk of decoded PCM audio data
#[derive(Clone)]
pub struct AudioChunk {
    /// Interleaved f32 samples
    pub samples: Vec<f32>,
    /// Sample rate of this chunk
    pub sample_rate: u32,
    /// Number of channels
    pub channels: u16,
}

/// Shared ring buffer between decoder thread and audio output
pub struct SharedBuffer {
    inner: Mutex<SharedBufferInner>,
    /// Signal when buffer has space (producer waits)
    not_full: Condvar,
    /// Signal when buffer has data (consumer waits)
    not_empty: Condvar,
}

struct SharedBufferInner {
    queue: VecDeque<AudioChunk>,
    capacity: usize,
    finished: bool,
    abort: bool,
}

impl SharedBuffer {
    pub fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(SharedBufferInner {
                queue: VecDeque::with_capacity(capacity),
                capacity,
                finished: false,
                abort: false,
            }),
            not_full: Condvar::new(),
            not_empty: Condvar::new(),
        })
    }

    /// Push a chunk, blocking if buffer is full. Returns false if aborted.
    pub fn push(&self, chunk: AudioChunk) -> bool {
        let mut inner = self.inner.lock();
        while inner.queue.len() >= inner.capacity && !inner.abort {
            self.not_full.wait(&mut inner);
        }
        if inner.abort {
            return false;
        }
        inner.queue.push_back(chunk);
        self.not_empty.notify_one();
        true
    }

    /// Pop a chunk, blocking if buffer is empty. Returns None if finished and empty.
    pub fn pop(&self) -> Option<AudioChunk> {
        let mut inner = self.inner.lock();
        loop {
            if let Some(chunk) = inner.queue.pop_front() {
                self.not_full.notify_one();
                return Some(chunk);
            }
            if inner.finished || inner.abort {
                return None;
            }
            self.not_empty.wait(&mut inner);
        }
    }

    /// Try to pop without blocking
    pub fn try_pop(&self) -> Option<AudioChunk> {
        let mut inner = self.inner.lock();
        let chunk = inner.queue.pop_front();
        if chunk.is_some() {
            self.not_full.notify_one();
        }
        chunk
    }

    /// Mark decoding as finished (no more chunks will be pushed)
    pub fn mark_finished(&self) {
        let mut inner = self.inner.lock();
        inner.finished = true;
        self.not_empty.notify_all();
    }

    /// Abort decoding — unblock both sides
    pub fn abort(&self) {
        let mut inner = self.inner.lock();
        inner.abort = true;
        self.not_full.notify_all();
        self.not_empty.notify_all();
    }

    /// Clear the buffer (used during seek)
    pub fn clear(&self) {
        let mut inner = self.inner.lock();
        inner.queue.clear();
        inner.finished = false;
        self.not_full.notify_all();
    }

    /// Check if the buffer is finished and empty
    pub fn is_done(&self) -> bool {
        let inner = self.inner.lock();
        inner.finished && inner.queue.is_empty()
    }

    /// Number of chunks currently buffered
    pub fn len(&self) -> usize {
        self.inner.lock().queue.len()
    }
}

/// Metadata extracted from the audio file
#[derive(Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub cover: Option<Vec<u8>>,
}

/// Target format for resampling
const TARGET_SAMPLE_RATE: u32 = 48000;
const TARGET_CHANNELS: u16 = 2;
/// FFT always receives mono 44100Hz
pub const FFT_SAMPLE_RATE: u32 = 44100;

/// Start a decoder thread for the given source (file path or URL).
/// Returns (SharedBuffer, metadata) on success.
pub fn start_decode(
    source: &str,
    fft_buffer: Option<Arc<Mutex<Vec<f32>>>>,
) -> Result<(Arc<SharedBuffer>, AudioMetadata)> {
    // Open input with FFmpeg
    let mut ictx = ffmpeg_next::format::input(&source)
        .with_context(|| format!("Failed to open: {}", source))?;

    // Find the best audio stream
    let stream = ictx
        .streams()
        .best(ffmpeg_next::media::Type::Audio)
        .context("No audio stream found")?;
    let stream_index = stream.index();

    // Extract metadata
    let duration_secs = if ictx.duration() > 0 {
        ictx.duration() as f64 / f64::from(ffmpeg_next::ffi::AV_TIME_BASE)
    } else {
        0.0
    };

    let metadata_dict = ictx.metadata();
    let title = metadata_dict.get("title").map(|s| s.to_string());
    let artist = metadata_dict.get("artist").map(|s| s.to_string());
    let album = metadata_dict.get("album").map(|s| s.to_string());

    // Set up the decoder
    let context =
        ffmpeg_next::codec::context::Context::from_parameters(stream.parameters().clone())?;
    let mut audio_decoder = context.decoder().audio()?;

    let src_rate = audio_decoder.rate();
    let src_channels = audio_decoder.channels() as u16;
    let src_format = audio_decoder.format();

    let metadata = AudioMetadata {
        title,
        artist,
        album,
        duration_secs,
        sample_rate: TARGET_SAMPLE_RATE,
        channels: TARGET_CHANNELS,
        cover: None, // TODO: extract embedded cover art
    };

    let buffer = SharedBuffer::new(64);
    let buffer_clone = Arc::clone(&buffer);

    // Configure resampler for playback output (stereo, target sample rate)
    let mut resampler = ffmpeg_next::software::resampling::Context::get(
        src_format,
        ffmpeg_next::ChannelLayout::default(src_channels as i32),
        src_rate,
        ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
        ffmpeg_next::ChannelLayout::default(TARGET_CHANNELS as i32),
        TARGET_SAMPLE_RATE,
    )?;

    // Configure resampler for FFT (mono, 44100 Hz)
    let mut fft_resampler = if fft_buffer.is_some() {
        Some(ffmpeg_next::software::resampling::Context::get(
            src_format,
            ffmpeg_next::ChannelLayout::default(src_channels as i32),
            src_rate,
            ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
            ffmpeg_next::ChannelLayout::default(1),
            FFT_SAMPLE_RATE,
        )?)
    } else {
        None
    };

    let source_owned = source.to_string();

    thread::spawn(move || {
        let _result = decode_loop(
            &mut ictx,
            &mut audio_decoder,
            &mut resampler,
            &mut fft_resampler,
            stream_index,
            &buffer_clone,
            &fft_buffer,
        );
        buffer_clone.mark_finished();
    });

    Ok((buffer, metadata))
}

fn decode_loop(
    ictx: &mut ffmpeg_next::format::context::Input,
    decoder: &mut ffmpeg_next::decoder::Audio,
    resampler: &mut ffmpeg_next::software::resampling::Context,
    fft_resampler: &mut Option<ffmpeg_next::software::resampling::Context>,
    stream_index: usize,
    buffer: &SharedBuffer,
    fft_buffer: &Option<Arc<Mutex<Vec<f32>>>>,
) -> Result<()> {
    let mut decoded_frame = ffmpeg_next::frame::Audio::empty();
    let mut resampled_frame = ffmpeg_next::frame::Audio::empty();
    let mut fft_frame = ffmpeg_next::frame::Audio::empty();

    for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder.send_packet(&packet)?;

        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            // Resample for playback
            resampler.run(&decoded_frame, &mut resampled_frame)?;
            let data = resampled_frame.data(0);
            let samples: Vec<f32> = data
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();

            let chunk = AudioChunk {
                samples,
                sample_rate: TARGET_SAMPLE_RATE,
                channels: TARGET_CHANNELS,
            };

            if !buffer.push(chunk) {
                return Ok(()); // aborted
            }

            // Resample for FFT
            if let (Some(ref mut fft_res), Some(ref fft_buf)) = (fft_resampler, fft_buffer) {
                fft_res.run(&decoded_frame, &mut fft_frame)?;
                let fft_data = fft_frame.data(0);
                let fft_samples: Vec<f32> = fft_data
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();

                let mut buf = fft_buf.lock();
                buf.extend_from_slice(&fft_samples);
                // Keep only the latest 8192 samples for FFT ring buffer
                if buf.len() > 8192 {
                    let drain_count = buf.len() - 8192;
                    buf.drain(..drain_count);
                }
            }
        }
    }

    // Flush decoder
    decoder.send_eof()?;
    while decoder.receive_frame(&mut decoded_frame).is_ok() {
        resampler.run(&decoded_frame, &mut resampled_frame)?;
        let data = resampled_frame.data(0);
        let samples: Vec<f32> = data
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();

        let chunk = AudioChunk {
            samples,
            sample_rate: TARGET_SAMPLE_RATE,
            channels: TARGET_CHANNELS,
        };

        if !buffer.push(chunk) {
            return Ok(());
        }
    }

    Ok(())
}

/// Seek to a position in seconds. Must be called from the decoder thread context
/// or by restarting decode with a seek position.
pub fn seek_decode(
    source: &str,
    position_secs: f64,
    buffer: &SharedBuffer,
    fft_buffer: Option<Arc<Mutex<Vec<f32>>>>,
) -> Result<()> {
    buffer.abort();
    buffer.clear();

    // Clear FFT buffer
    if let Some(ref fft_buf) = fft_buffer {
        fft_buf.lock().clear();
    }

    let mut ictx = ffmpeg_next::format::input(&source)?;

    // Seek to timestamp
    let ts = (position_secs * f64::from(ffmpeg_next::ffi::AV_TIME_BASE)) as i64;
    ictx.seek(ts, ..ts)?;

    let stream = ictx
        .streams()
        .best(ffmpeg_next::media::Type::Audio)
        .context("No audio stream")?;
    let stream_index = stream.index();

    let context =
        ffmpeg_next::codec::context::Context::from_parameters(stream.parameters().clone())?;
    let mut audio_decoder = context.decoder().audio()?;

    let src_rate = audio_decoder.rate();
    let src_channels = audio_decoder.channels() as u16;
    let src_format = audio_decoder.format();

    let mut resampler = ffmpeg_next::software::resampling::Context::get(
        src_format,
        ffmpeg_next::ChannelLayout::default(src_channels as i32),
        src_rate,
        ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
        ffmpeg_next::ChannelLayout::default(TARGET_CHANNELS as i32),
        TARGET_SAMPLE_RATE,
    )?;

    let mut fft_resampler = if fft_buffer.is_some() {
        Some(ffmpeg_next::software::resampling::Context::get(
            src_format,
            ffmpeg_next::ChannelLayout::default(src_channels as i32),
            src_rate,
            ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
            ffmpeg_next::ChannelLayout::default(1),
            FFT_SAMPLE_RATE,
        )?)
    } else {
        None
    };

    // Reset abort flag so buffer accepts new data
    {
        let mut inner = buffer.inner.lock();
        inner.abort = false;
        inner.finished = false;
    }

    decode_loop(
        &mut ictx,
        &mut audio_decoder,
        &mut resampler,
        &mut fft_resampler,
        stream_index,
        buffer,
        &fft_buffer,
    )?;

    buffer.mark_finished();
    Ok(())
}
