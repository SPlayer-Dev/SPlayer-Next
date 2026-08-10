//! FFmpeg 音频解码 + rodio 播放 + FFT 频谱分析。
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

mod audio_output;
mod bindings;
mod decoder;
mod device_watcher;
mod equalizer;
mod error;
mod fft;
mod logger;
mod loudness;
mod metadata;
mod player;
mod priority;
mod scanner;
mod shared;
mod source;
mod tempo;

pub use bindings::*;
