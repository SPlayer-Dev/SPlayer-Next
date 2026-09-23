mod processing;
mod reader;
use processing::run_dsp_safely;
use reader::{build_resamplers, open_source, run_decoding_loop};

pub(crate) mod buffer;
pub(crate) mod source;

use std::fs::File;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{ensure, Context, Result};
use ffmpeg_audio::{
    sys, AudioError, AudioReader, HttpAudioSource, HttpCancelHandle, ResampleOptions, Resampler,
    SeekMode,
};
use parking_lot::Mutex;
use tracing::debug;

use crate::decoder::buffer::{AudioChunk, Shared};
use crate::dsp::equalizer::Equalizer;
use crate::dsp::loudness::LoudnessAnalyzer;
use crate::dsp::tempo::StretchProcessor;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::metadata::{self, AudioMetadata};
use crate::priority;

/// 无输出设备信息时初始化 DSP 使用的默认声道数
pub const DEFAULT_OUTPUT_CHANNELS: u16 = 2;

/// 播放输出默认采样率
pub const DEFAULT_TARGET_SAMPLE_RATE: u32 = 48_000;

/// FFT 计算所需的目标采样率
pub const FFT_TARGET_SAMPLE_RATE: u32 = 48_000;

/// FFT 始终分析双声道视图，与真实播放输出声道链路相互独立
const FFT_CHANNELS: u16 = 2;

/// 自定义 File IO 读取失败时，ffmpeg_audio 的 read 回调可能映射为此错误码
const AVERROR_EIO: i32 = sys::averror(libc::EIO);

/// 解码会话所需的资源（跨 seek 复用，避免重建 ffmpeg_audio 上下文）
///
/// 此处必须进行 1-to-N 分发，因为需要两个可能存在采样率差异的音源
///  - 播放重采样器输出设备采样率、设备声道数的交错 f32
///  - FFT 重采样器输出 48kHz 的 stereo f32
pub struct DecoderData {
    reader: AudioReader,
    player_resampler: Resampler,
    fft_resampler: Resampler,
    /// 网络中断句柄仅由远端源持有，stop() 取消后可在 seek 前重置
    cancel_handle: Option<HttpCancelHandle>,
}

/// 已打开且完成元数据读取的音源，等待按实际输出流采样率创建重采样器
pub struct PreparedDecoder {
    reader: AudioReader,
    metadata: AudioMetadata,
    replay_gain_db: Option<f32>,
    cancel_handle: Option<HttpCancelHandle>,
}

impl PreparedDecoder {
    /// 音源原始采样率，用于输出流采样率协商（设备支持时按精确采样率打开）
    pub fn original_sample_rate(&self) -> u32 {
        self.metadata.original_sample_rate
    }

    /// 音源有效位深，独占模式协商候选的优先依据
    pub fn bits_per_sample(&self) -> u32 {
        self.metadata.bits_per_sample
    }
}

/// 统一结束解码线程；panic 属于源错误，但仍需结束 source 迭代
fn finish_decode_thread(shared: &Shared, panicked: bool) {
    if panicked {
        shared.mark_decode_failed();
    }
    shared.mark_eof();
}

fn run_decode_safely(shared: &Shared, decode: impl FnOnce()) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(decode));
    finish_decode_thread(shared, result.is_err());
}

/// 启动解码线程，返回音频元数据和线程句柄
///
/// 线程结束时返回 `DecoderData`，调用方可通过 `handle.join()` 回收并复用于后续 seek，
/// 避免重建 ffmpeg_audio 上下文。
pub fn prepare_decode(
    source: &str,
    cover_cache_dir: Option<&str>,
    cancel_handle: HttpCancelHandle,
) -> Result<PreparedDecoder> {
    let (reader, cancel_handle) = open_source(source, cancel_handle)?;

    let info = reader.source_info();
    let duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let stream_info = metadata::extract_stream_info(info);
    ensure!(stream_info.channels > 0, "源音频没有有效声道");
    let source_channels = u16::try_from(stream_info.channels).context("源音频声道数超出范围")?;
    let codec = info.codec_name.clone().unwrap_or_default();

    let raw_metadata = reader.metadata();
    let tags = metadata::extract_tags(&raw_metadata);
    let cover =
        cover_cache_dir.and_then(|dir| metadata::extract_cover_thumbnail(&reader, source, dir));
    let cover_raw = metadata::read_attached_pic(&reader);
    let embedded_lyric = metadata::extract_embedded_lyric(&raw_metadata);
    let external_lyrics = metadata::find_all_external_lyrics(source);
    let replay_gain_db = metadata::extract_replay_gain(&raw_metadata);

    let metadata = AudioMetadata {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        comment: tags.comment,
        duration_secs,
        sample_rate: stream_info.sample_rate,
        channels: source_channels,
        original_sample_rate: stream_info.sample_rate,
        bits_per_sample: stream_info.bits_per_sample,
        bit_rate: stream_info.bit_rate,
        codec,
        embedded_lyric,
        external_lyrics,
        cover,
        cover_raw,
    };

    Ok(PreparedDecoder {
        reader,
        metadata,
        replay_gain_db,
        cancel_handle,
    })
}

/// 按已经打开的输出流采样率启动解码，避免为探测音源信息重复打开网络源
pub fn start_prepared_decode(
    prepared: PreparedDecoder,
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) -> Result<(
    AudioMetadata,
    JoinHandle<DecoderData>,
    Option<HttpCancelHandle>,
)> {
    let PreparedDecoder {
        reader,
        mut metadata,
        replay_gain_db,
        cancel_handle,
    } = prepared;
    let target_rate = shared.sample_rate();
    let (player_resampler, fft_resampler) =
        build_resamplers(&reader, target_rate, shared.channels())?;
    metadata.sample_rate = target_rate;

    if let Some(db) = replay_gain_db {
        shared.set_normalization_gain(metadata::db_to_linear(db));
    }
    if let Some(handle) = &cancel_handle {
        shared.bind_cancel_handle(handle.clone());
    }

    let data = DecoderData {
        reader,
        player_resampler,
        fft_resampler,
        cancel_handle: cancel_handle.clone(),
    };

    let handle = thread::Builder::new()
        .name("audio-decoder".to_string())
        .spawn(move || {
            priority::boost_current_audio_thread("audio-decoder");
            let mut data = data;
            let dsp_shared = Arc::clone(&shared);
            let dsp_handle = thread::Builder::new()
                .name("audio-dsp".to_string())
                .spawn(move || run_dsp_safely(dsp_shared, equalizer, tempo));
            let Ok(dsp_handle) = dsp_handle else {
                shared.mark_decode_failed();
                shared.mark_output_eof();
                return data;
            };
            run_decode_safely(&shared, || {
                run_decoding_loop(&mut data, &shared);
            });
            if dsp_handle.join().is_err() {
                shared.mark_decode_failed();
                shared.mark_output_eof();
            }
            data
        })
        .context("启动解码线程失败")
        .with_audio_kind(AudioErrorKind::DecodeFailed)?;

    Ok((metadata, handle, cancel_handle))
}

/// 用已有的 DecoderData 继续解码（seek 后复用）
pub fn resume_decode(
    data: DecoderData,
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) -> Result<JoinHandle<DecoderData>> {
    if let Some(handle) = data.cancel_handle() {
        shared.bind_cancel_handle(handle);
    }
    thread::Builder::new()
        .name("audio-decoder".to_string())
        .spawn(move || {
            priority::boost_current_audio_thread("audio-decoder");
            let mut data = data;
            let dsp_shared = Arc::clone(&shared);
            let dsp_handle = thread::Builder::new()
                .name("audio-dsp".to_string())
                .spawn(move || run_dsp_safely(dsp_shared, equalizer, tempo));
            let Ok(dsp_handle) = dsp_handle else {
                shared.mark_decode_failed();
                shared.mark_output_eof();
                return data;
            };
            run_decode_safely(&shared, || {
                run_decoding_loop(&mut data, &shared);
            });
            if dsp_handle.join().is_err() {
                shared.mark_decode_failed();
                shared.mark_output_eof();
            }
            data
        })
        .context("启动解码线程失败")
        .with_audio_kind(AudioErrorKind::DecodeFailed)
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
