use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};

use crate::decoder::{self, AudioChunk, AudioMetadata, SharedBuffer};
use crate::fft::FftAnalyzer;

/// A rodio::Source implementation that reads from the SharedBuffer
struct DecoderSource {
    buffer: Arc<SharedBuffer>,
    current_chunk: Vec<f32>,
    cursor: usize,
    sample_rate: u32,
    channels: u16,
}

impl DecoderSource {
    fn new(buffer: Arc<SharedBuffer>, sample_rate: u32, channels: u16) -> Self {
        Self {
            buffer,
            current_chunk: Vec::new(),
            cursor: 0,
            sample_rate,
            channels,
        }
    }
}

impl Iterator for DecoderSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        // If we still have samples in current chunk, return one
        if self.cursor < self.current_chunk.len() {
            let sample = self.current_chunk[self.cursor];
            self.cursor += 1;
            return Some(sample);
        }

        // Try to get the next chunk from the buffer
        match self.buffer.try_pop() {
            Some(chunk) => {
                self.current_chunk = chunk.samples;
                self.cursor = 1;
                self.current_chunk.first().copied()
            }
            None => {
                if self.buffer.is_done() {
                    None // Stream finished
                } else {
                    Some(0.0) // Buffer underrun — output silence
                }
            }
        }
    }
}

impl Source for DecoderSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Player state
#[derive(Clone, Copy, PartialEq)]
pub enum PlayerState {
    Idle,
    Playing,
    Paused,
    Stopped,
}

/// Inner player that manages audio output, decoding, and state
pub struct InnerPlayer {
    /// rodio OutputStream — must be kept alive for audio output
    _stream: OutputStream,
    /// Handle used to create sinks
    stream_handle: OutputStreamHandle,
    /// Current audio sink
    sink: Option<Sink>,
    /// Shared buffer between decoder and playback
    buffer: Option<Arc<SharedBuffer>>,
    /// FFT analyzer
    fft: FftAnalyzer,
    /// Current metadata
    metadata: Option<AudioMetadata>,
    /// Playback state
    state: PlayerState,
    /// Position tracking
    position_base: f64,
    play_start: Option<Instant>,
    /// Current source path/URL (for seek/reload)
    current_source: Option<String>,
}

impl InnerPlayer {
    pub fn new() -> Result<Self> {
        let (stream, stream_handle) =
            OutputStream::try_default().context("Failed to open audio output device")?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink: None,
            buffer: None,
            fft: FftAnalyzer::new(decoder::FFT_SAMPLE_RATE),
            metadata: None,
            state: PlayerState::Idle,
            position_base: 0.0,
            play_start: None,
            current_source: None,
        })
    }

    /// Load and start playing an audio source (file path or URL)
    pub fn load(&mut self, source: &str) -> Result<AudioMetadata> {
        // Stop current playback
        self.stop_internal();

        // Reset FFT
        self.fft.reset();

        // Start decoding
        let fft_buffer = Some(self.fft.buffer());
        let (buffer, metadata) = decoder::start_decode(source, fft_buffer)?;

        // Create a new sink
        let sink = Sink::try_new(&self.stream_handle)
            .context("Failed to create audio sink")?;

        // Create the source adapter
        let decoder_source = DecoderSource::new(
            Arc::clone(&buffer),
            metadata.sample_rate,
            metadata.channels,
        );

        sink.append(decoder_source);

        self.sink = Some(sink);
        self.buffer = Some(buffer);
        self.metadata = Some(metadata.clone());
        self.state = PlayerState::Playing;
        self.position_base = 0.0;
        self.play_start = Some(Instant::now());
        self.current_source = Some(source.to_string());

        Ok(metadata)
    }

    /// Resume playback
    pub fn play(&mut self) {
        if let Some(ref sink) = self.sink {
            sink.play();
            self.play_start = Some(Instant::now());
            self.state = PlayerState::Playing;
        }
    }

    /// Pause playback
    pub fn pause(&mut self) {
        if let Some(ref sink) = self.sink {
            sink.pause();
            // Accumulate played time into position_base
            if let Some(start) = self.play_start.take() {
                self.position_base += start.elapsed().as_secs_f64();
            }
            self.state = PlayerState::Paused;
        }
    }

    /// Stop playback and release resources
    pub fn stop(&mut self) {
        self.stop_internal();
        self.state = PlayerState::Stopped;
    }

    fn stop_internal(&mut self) {
        // Abort the decoder buffer to unblock the decoder thread
        if let Some(ref buffer) = self.buffer {
            buffer.abort();
        }

        // Drop the sink to stop playback
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        self.buffer = None;
        self.play_start = None;
        self.position_base = 0.0;
    }

    /// Seek to a position in seconds
    pub fn seek(&mut self, position_secs: f64) -> Result<()> {
        let source = self
            .current_source
            .clone()
            .context("No source loaded")?;

        // Stop current playback
        if let Some(ref buffer) = self.buffer {
            buffer.abort();
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        // Reset FFT
        self.fft.reset();

        // Restart decode from new position
        let fft_buffer = Some(self.fft.buffer());
        let buffer = SharedBuffer::new(64);
        let buffer_clone = Arc::clone(&buffer);

        let source_clone = source.clone();
        let fft_buf = fft_buffer.clone();
        std::thread::spawn(move || {
            let _ = decoder::seek_decode(&source_clone, position_secs, &buffer_clone, fft_buf);
        });

        // Create new sink
        let sink = Sink::try_new(&self.stream_handle)
            .context("Failed to create audio sink")?;

        let metadata = self.metadata.as_ref().unwrap();
        let decoder_source = DecoderSource::new(
            Arc::clone(&buffer),
            metadata.sample_rate,
            metadata.channels,
        );

        sink.append(decoder_source);

        self.sink = Some(sink);
        self.buffer = Some(buffer);
        self.position_base = position_secs;
        self.play_start = Some(Instant::now());
        self.state = PlayerState::Playing;

        Ok(())
    }

    /// Set volume (0.0 to 1.0)
    pub fn set_volume(&mut self, volume: f32) {
        if let Some(ref sink) = self.sink {
            sink.set_volume(volume);
        }
    }

    /// Get current volume
    pub fn volume(&self) -> f32 {
        self.sink.as_ref().map(|s| s.volume()).unwrap_or(1.0)
    }

    /// Get current playback position in seconds
    pub fn position(&self) -> f64 {
        match (self.state, self.play_start) {
            (PlayerState::Playing, Some(start)) => {
                self.position_base + start.elapsed().as_secs_f64()
            }
            _ => self.position_base,
        }
    }

    /// Get duration in seconds
    pub fn duration(&self) -> f64 {
        self.metadata
            .as_ref()
            .map(|m| m.duration_secs)
            .unwrap_or(0.0)
    }

    /// Get current player state
    pub fn state(&self) -> PlayerState {
        self.state
    }

    /// Get current metadata
    pub fn metadata(&self) -> Option<&AudioMetadata> {
        self.metadata.as_ref()
    }

    /// Get FFT spectrum data (128 frequency bins)
    pub fn fft_data(&self) -> Vec<f32> {
        self.fft.analyze()
    }

    /// Check if playback has reached the end
    pub fn is_finished(&self) -> bool {
        if let Some(ref buffer) = self.buffer {
            if let Some(ref sink) = self.sink {
                return buffer.is_done() && sink.empty();
            }
        }
        false
    }
}
