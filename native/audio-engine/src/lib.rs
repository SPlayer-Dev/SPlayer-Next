//! FFmpeg 音频解码 + CPAL 播放 + FFT 频谱分析。
//! 通过 NAPI-RS 暴露给 Node.js，作为 Electron 主进程的原生模块。

mod bindings;
mod decoder;
mod dsp;
mod error;
mod logger;
mod metadata;
mod output;
mod player;
mod priority;
mod scanner;

#[cfg(test)]
mod tests;

pub use bindings::*;
