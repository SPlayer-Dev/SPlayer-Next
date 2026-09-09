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

use crate::equalizer::Equalizer;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::loudness::LoudnessAnalyzer;
use crate::metadata::{self, AudioMetadata};
use crate::priority;
use crate::shared::{AudioChunk, Shared};
use crate::tempo::StretchProcessor;

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

const OUTPUT_CEILING: f32 = 0.98;
const LIMITER_RELEASE: f32 = 0.0005;

struct OutputLimiter {
    gain: f32,
}

impl OutputLimiter {
    fn new() -> Self {
        Self { gain: 1.0 }
    }

    fn process(&mut self, samples: &mut [f32], channels: u16) {
        let channels = usize::from(channels);
        debug_assert!(channels > 0 && samples.len().is_multiple_of(channels));
        for frame in samples.chunks_exact_mut(channels) {
            let peak = frame
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
            let target_gain = if peak > OUTPUT_CEILING {
                OUTPUT_CEILING / peak
            } else {
                1.0
            };
            if peak * self.gain >= OUTPUT_CEILING {
                self.gain = target_gain;
            } else {
                self.gain += (1.0 - self.gain) * LIMITER_RELEASE;
            }
            for sample in frame {
                *sample *= self.gain;
                *sample = sample.clamp(-OUTPUT_CEILING, OUTPUT_CEILING);
            }
        }
    }
}

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

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    ///
    /// seek 后两个重采样器要 flush 掉残留样本，否则播放/FFT会带上上一段尾巴
    pub fn seek(&mut self, position_secs: f64) -> bool {
        if let Some(handle) = &self.cancel_handle {
            handle.reset();
        }
        let target = Duration::from_secs_f64(position_secs);
        if self.reader.seek(target, SeekMode::Accurate).is_err()
            && self.reader.seek(target, SeekMode::Coarse).is_err()
        {
            return false;
        }
        let _ = self.player_resampler.flush();
        let _ = self.fft_resampler.flush();
        true
    }

    /// 获取网络中断句柄，恢复解码时绑定到新的共享状态
    pub fn cancel_handle(&self) -> Option<HttpCancelHandle> {
        self.cancel_handle.clone()
    }

    /// 输出设备格式变化后重建播放重采样器；FFT 分支仍保持固定双声道分析格式
    pub fn reconfigure_player_output(&mut self, sample_rate: u32, channels: u16) -> Result<()> {
        self.player_resampler = build_player_resampler(&self.reader, sample_rate, channels)?;
        Ok(())
    }
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

fn process_audio_chunk(
    mut chunk: AudioChunk,
    equalizer: &Mutex<Equalizer>,
    tempo: &Mutex<StretchProcessor>,
    limiter: &mut OutputLimiter,
    tempo_scratch: &mut Vec<f32>,
    channels: u16,
) -> AudioChunk {
    if chunk.player_samples.is_empty() {
        return chunk;
    }

    equalizer
        .lock()
        .process_interleaved(&mut chunk.player_samples);
    if tempo.lock().is_bypass() {
        limiter.process(&mut chunk.player_samples, channels);
        return chunk;
    }

    tempo_scratch.clear();
    tempo.lock().process(&chunk.player_samples, tempo_scratch);
    limiter.process(tempo_scratch, channels);
    std::mem::swap(&mut chunk.player_samples, tempo_scratch);
    chunk
}

fn run_dsp_loop(shared: &Shared, equalizer: &Mutex<Equalizer>, tempo: &Mutex<StretchProcessor>) {
    let mut limiter = OutputLimiter::new();
    let mut tempo_scratch = shared.take_player_buffer();
    while let Some(chunk) = shared.pop_decoded() {
        let chunk = process_audio_chunk(
            chunk,
            equalizer,
            tempo,
            &mut limiter,
            &mut tempo_scratch,
            shared.channels(),
        );
        shared.push_output(chunk);
        if shared.is_stopping() {
            break;
        }
    }
    shared.recycle_player_buffer(tempo_scratch);
}

fn run_dsp_safely(
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_dsp_loop(&shared, &equalizer, &tempo);
    }));
    if result.is_err() {
        shared.mark_decode_failed();
    }
    shared.mark_output_eof();
}

/// 根据 source 协议打开音频：http(s) 走延迟 Range 源，其他走本地 File
///
fn open_source(
    source: &str,
    cancel_handle: HttpCancelHandle,
) -> Result<(AudioReader, Option<HttpCancelHandle>)> {
    let (reader, cancel) = if source.starts_with("http://") || source.starts_with("https://") {
        let http = HttpAudioSource::new_with_cancel_handle(source, &cancel_handle)?;
        let reader =
            AudioReader::new(http).with_context(|| format!("打开网络音频失败: {source}"))?;
        (reader, Some(cancel_handle))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        let reader =
            AudioReader::new(file).with_context(|| format!("打开本地音频失败: {source}"))?;
        (reader, None)
    };

    Ok((reader, cancel))
}

fn build_player_resampler(
    reader: &AudioReader,
    target_rate: u32,
    target_channels: u16,
) -> Result<Resampler> {
    let player_opts = ResampleOptions::new()
        .sample_rate(target_rate as i32)
        .channels(i32::from(target_channels))
        .format::<f32>();
    reader
        .build_resampler(player_opts)
        .with_context(|| "构建播放重采样器失败")
}

fn build_resamplers(
    reader: &AudioReader,
    target_rate: u32,
    target_channels: u16,
) -> Result<(Resampler, Resampler)> {
    let player_resampler = build_player_resampler(reader, target_rate, target_channels)?;

    let fft_opts = ResampleOptions::new()
        .sample_rate(FFT_TARGET_SAMPLE_RATE as i32)
        .channels(i32::from(FFT_CHANNELS))
        .format::<f32>();
    let fft_resampler = reader
        .build_resampler(fft_opts)
        .with_context(|| "构建 FFT 重采样器失败")?;

    Ok((player_resampler, fft_resampler))
}

/// 核心解码循环：每帧解码一次，使用复用缓冲分发到播放与 FFT 重采样器
fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new(shared.sample_rate(), shared.channels());
    loudness.set_has_replay_gain(has_replay_gain);

    // 用于日志诊断：记录是否曾成功解码过帧
    let mut had_success = false;

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }

        match data.reader.receive_frame() {
            Ok(Some(frame)) => {
                // 1-to-N: 同一帧顺序喂两个重采样器
                if data.player_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("player resampler 处理失败，结束解码");
                    shared.mark_decode_failed();
                    return;
                }
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(data.player_resampler.output_as::<f32>());

                if data.fft_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("fft resampler 处理失败，结束解码");
                    shared.recycle_player_buffer(player_samples);
                    shared.mark_decode_failed();
                    return;
                }
                let mut fft_samples = shared.take_fft_buffer();
                fft_samples.extend_from_slice(data.fft_resampler.output_as::<f32>());

                // 重采样可能还在攒样本，本轮没出数据就跳过
                if player_samples.is_empty() && fft_samples.is_empty() {
                    shared.recycle_player_buffer(player_samples);
                    shared.recycle_fft_buffer(fft_samples);
                    continue;
                }
                had_success = true;

                if shared.is_normalization_enabled() && !player_samples.is_empty() {
                    let gain = if has_replay_gain {
                        shared.normalization_gain()
                    } else {
                        loudness.process(&player_samples)
                    };
                    if (gain - 1.0).abs() > f32::EPSILON {
                        for s in &mut player_samples {
                            *s *= gain;
                        }
                    }
                }

                shared.push(AudioChunk {
                    source_sample_count: player_samples.len() as u64,
                    player_samples,
                    fft_samples,
                });
            }
            Ok(None) | Err(AudioError::Eof) => {
                // EOF flush：把两个重采样器内部残留挤出来，否则最后几十毫秒丢
                let _ = data.player_resampler.process::<f32>(None);
                let _ = data.fft_resampler.process::<f32>(None);
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(data.player_resampler.output_as::<f32>());
                let mut fft_samples = shared.take_fft_buffer();
                fft_samples.extend_from_slice(data.fft_resampler.output_as::<f32>());
                if !player_samples.is_empty() || !fft_samples.is_empty() {
                    shared.push(AudioChunk {
                        source_sample_count: player_samples.len() as u64,
                        player_samples,
                        fft_samples,
                    });
                } else {
                    shared.recycle_player_buffer(player_samples);
                    shared.recycle_fft_buffer(fft_samples);
                }
                return;
            }
            Err(e) => {
                // stop/切歌触发的 HTTP 取消不是源故障
                if shared.is_stopping() {
                    debug!(error = %e, "解码线程因停止信号退出");
                    return;
                }
                // 本地 File 的 io::Error 可能经 ffmpeg_audio read 回调映射为 AVERROR(EIO)
                let io_failure = match &e {
                    AudioError::Io(_) => true,
                    AudioError::FFmpeg(code, _) => *code == AVERROR_EIO,
                    _ => false,
                };
                // 统一标记 decode_failed：包括 IO 错误和 FFmpeg 数据错误
                // 长时间暂停后 HTTP 流断开重连、URL 过期等场景下 FFmpeg 会报
                // INVALIDDATA（非 EIO），但本质仍是数据源故障，需要标记以触发
                // SourceError 让 JS 重新解析播放地址
                // 尾部坏帧（FLAC ID3v1 / VBR 末帧）容忍由 position timer 的 3s
                // 阈值保障：mark_decode_failed 后若 position 接近末尾仍发 Ended
                shared.mark_decode_failed();
                debug!(error = %e, had_success, io_failure, "解码线程异常结束");
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::PopResult;
    use std::io::Cursor;

    fn mono_wav() -> Vec<u8> {
        let sample_rate = 48_000_u32;
        let frames = 1024_u32;
        let data_size = frames * 2;
        let mut bytes = Vec::with_capacity(44 + data_size as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        bytes.resize(44 + data_size as usize, 0);
        bytes
    }

    #[test]
    fn panic_marks_decode_failed_and_finishes_source() {
        let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

        run_decode_safely(&shared, || panic!("模拟解码 panic"));

        assert!(shared.is_decode_failed());
        assert!(shared.pop_decoded().is_none());
        shared.mark_output_eof();
        assert!(matches!(shared.try_pop(), PopResult::Finished));
    }

    #[test]
    fn normal_completion_does_not_mark_decode_failed() {
        let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

        run_decode_safely(&shared, || {});

        assert!(!shared.is_decode_failed());
        assert!(shared.pop_decoded().is_none());
        shared.mark_output_eof();
        assert!(matches!(shared.try_pop(), PopResult::Finished));
    }

    #[test]
    fn dsp_applies_equalizer_and_limiter_before_output() {
        let equalizer = Mutex::new(Equalizer::new(48_000, 2));
        equalizer.lock().set_enabled(true);
        equalizer.lock().set_preamp_db(12.0);
        let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
        let mut limiter = OutputLimiter::new();
        let mut scratch = Vec::new();

        let processed = process_audio_chunk(
            AudioChunk {
                player_samples: vec![0.8, -0.8],
                fft_samples: Vec::new(),
                source_sample_count: 2,
            },
            &equalizer,
            &tempo,
            &mut limiter,
            &mut scratch,
            2,
        );

        assert!(processed
            .player_samples
            .iter()
            .all(|sample| sample.abs() <= OUTPUT_CEILING + 1e-6));
    }

    #[test]
    fn tempo_changes_output_length_but_preserves_source_count() {
        let equalizer = Mutex::new(Equalizer::new(48_000, 2));
        let tempo = Mutex::new(StretchProcessor::new(2, 48_000));
        tempo.lock().set_speed(2.0);
        let mut limiter = OutputLimiter::new();
        let mut scratch = Vec::new();
        let input = vec![0.1; 4096];

        let processed = process_audio_chunk(
            AudioChunk {
                source_sample_count: input.len() as u64,
                player_samples: input,
                fft_samples: Vec::new(),
            },
            &equalizer,
            &tempo,
            &mut limiter,
            &mut scratch,
            2,
        );

        assert_eq!(processed.source_sample_count, 4096);
        assert_eq!(processed.player_samples.len(), 2048);
    }

    #[test]
    fn limiter_uses_one_gain_for_the_whole_multichannel_frame() {
        let mut limiter = OutputLimiter::new();
        let original = [2.0_f32, 1.0, 0.5, -0.5, -1.0, -2.0];
        let mut samples = original;

        limiter.process(&mut samples, 6);

        let gain = samples[0] / original[0];
        for (actual, input) in samples.iter().zip(original) {
            assert!((actual / input - gain).abs() < 1e-6);
        }
        assert!(samples.iter().all(|sample| sample.abs() <= OUTPUT_CEILING));
    }

    #[test]
    fn playback_and_fft_resamplers_use_independent_channel_counts() {
        let mut reader = AudioReader::new(Cursor::new(mono_wav())).unwrap();
        assert_eq!(reader.source_info().channels, 1);
        let (mut player_resampler, mut fft_resampler) =
            build_resamplers(&reader, 48_000, 6).unwrap();
        let frame = reader.receive_frame().unwrap().unwrap();

        player_resampler.process::<f32>(Some(&frame)).unwrap();
        fft_resampler.process::<f32>(Some(&frame)).unwrap();

        let player_samples = player_resampler.output_as::<f32>();
        let fft_samples = fft_resampler.output_as::<f32>();
        assert!(!player_samples.is_empty());
        assert!(!fft_samples.is_empty());
        assert_eq!(player_samples.len() % 6, 0);
        assert_eq!(fft_samples.len() % usize::from(FFT_CHANNELS), 0);
    }
}
