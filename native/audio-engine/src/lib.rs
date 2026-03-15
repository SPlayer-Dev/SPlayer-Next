#[macro_use]
extern crate napi_derive;

mod decoder;
mod fft;
mod player;

use napi::{Error, Result};
use parking_lot::Mutex;
use player::{InnerPlayer, PlayerState};

/// Audio metadata returned to JS
#[napi(object)]
pub struct JsAudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
}

/// Player status returned to JS
#[napi(object)]
pub struct JsPlayerStatus {
    /// "idle" | "playing" | "paused" | "stopped"
    pub state: String,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub is_finished: bool,
}

/// The main AudioPlayer class exposed to Node.js via napi-rs
#[napi]
pub struct AudioPlayer {
    inner: Mutex<InnerPlayer>,
}

#[napi]
impl AudioPlayer {
    /// Create a new AudioPlayer instance
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self {
            inner: Mutex::new(inner),
        })
    }

    /// Load an audio source (file path or URL) and start playback.
    /// Returns audio metadata.
    #[napi]
    pub fn load(&self, source: String) -> Result<JsAudioMetadata> {
        let mut player = self.inner.lock();
        let metadata = player
            .load(&source)
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(JsAudioMetadata {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration_secs,
            sample_rate: metadata.sample_rate,
            channels: metadata.channels as u32,
        })
    }

    /// Resume playback
    #[napi]
    pub fn play(&self) {
        self.inner.lock().play();
    }

    /// Pause playback
    #[napi]
    pub fn pause(&self) {
        self.inner.lock().pause();
    }

    /// Stop playback
    #[napi]
    pub fn stop(&self) {
        self.inner.lock().stop();
    }

    /// Seek to a position in seconds
    #[napi]
    pub fn seek(&self, position: f64) -> Result<()> {
        self.inner
            .lock()
            .seek(position)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// Set volume (0.0 to 1.0)
    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.inner.lock().set_volume(volume as f32);
    }

    /// Get current volume (0.0 to 1.0)
    #[napi]
    pub fn get_volume(&self) -> f64 {
        self.inner.lock().volume() as f64
    }

    /// Get current playback position in seconds
    #[napi]
    pub fn get_position(&self) -> f64 {
        self.inner.lock().position()
    }

    /// Get duration in seconds
    #[napi]
    pub fn get_duration(&self) -> f64 {
        self.inner.lock().duration()
    }

    /// Get current player status
    #[napi]
    pub fn get_status(&self) -> JsPlayerStatus {
        let player = self.inner.lock();
        JsPlayerStatus {
            state: match player.state() {
                PlayerState::Idle => "idle".to_string(),
                PlayerState::Playing => "playing".to_string(),
                PlayerState::Paused => "paused".to_string(),
                PlayerState::Stopped => "stopped".to_string(),
            },
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
        }
    }

    /// Get FFT frequency spectrum data (128 bins, values 0.0-1.0)
    #[napi]
    pub fn get_fft_data(&self) -> Vec<f64> {
        self.inner
            .lock()
            .fft_data()
            .into_iter()
            .map(|v| v as f64)
            .collect()
    }
}
