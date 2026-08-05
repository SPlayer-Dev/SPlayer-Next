use std::fs::File;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use ffmpeg_audio::{AudioError, AudioReader, ResampleOptions, Resampler, SeekMode, sys};
use tracing::{debug, error};

use crate::http_source::{HttpInterrupt, HttpRangeSource};
use crate::loudness::LoudnessAnalyzer;
use crate::metadata;
use crate::shared::{AudioChunk, AudioMetadata, Shared};

/// 播放输出目标格式（重采样后送入 CPAL ring）
pub const TARGET_CHANNELS: u16 = 2;

/// 播放输出默认采样率
pub const DEFAULT_TARGET_SAMPLE_RATE: u32 = 48_000;

/// 自定义 File IO 读取失败时，ffmpeg_audio 的 read 回调可能映射为此错误码
const AVERROR_EIO: i32 = sys::averror(libc::EIO);

/// 解码会话所需的资源（跨 seek 复用，避免重建 ffmpeg_audio 上下文）
///
/// 音频只按实际输出 stream 配置做一次重采样；FFT 在 DSP 输出线程消费同一份 PCM。
pub struct DecoderData {
    reader: AudioReader,
    player_resampler: Resampler,
    /// 网络中断句柄仅由远端源持有，stop() 取消后可在 seek 前重置
    interrupt: Option<HttpInterrupt>,
}

/// 已打开且完成元数据读取的音源，等待按实际输出流采样率创建重采样器
pub struct PreparedDecoder {
    reader: AudioReader,
    metadata: AudioMetadata,
    replay_gain_db: Option<f32>,
    interrupt: Option<HttpInterrupt>,
}

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    ///
    /// seek 后要 flush 掉重采样器残留样本，否则播放会带上上一段尾巴
    pub fn seek(&mut self, position_secs: f64) -> bool {
        if let Some(interrupt) = &self.interrupt {
            interrupt.reset();
        }
        let target = Duration::from_secs_f64(position_secs);
        if self.reader.seek(target, SeekMode::Accurate).is_err()
            && self.reader.seek(target, SeekMode::Coarse).is_err()
        {
            return false;
        }
        let _ = self.player_resampler.flush();
        true
    }

    /// 获取网络中断句柄，恢复解码时绑定到新的共享状态
    pub fn interrupt_handle(&self) -> Option<HttpInterrupt> {
        self.interrupt.clone()
    }
}

/// 启动解码线程，返回音频元数据和线程句柄
///
/// 线程结束时返回 `DecoderData`，调用方可通过 `handle.join()` 回收并复用于后续 seek，
/// 避免重建 ffmpeg_audio 上下文。
pub fn prepare_decode(
    source: &str,
    cover_cache_dir: Option<&str>,
    interrupt: HttpInterrupt,
) -> Result<PreparedDecoder> {
    let (reader, interrupt) = open_source(source, interrupt)?;

    let info = reader.source_info();
    let duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let stream_info = metadata::extract_stream_info(info);
    let codec = info.codec_name.clone().unwrap_or_default();

    let raw_metadata = reader.metadata();
    let tags = metadata::extract_tags(&raw_metadata);
    let cover_raw = reader.cover().map(|cover| cover.data);
    let cover = cover_raw.as_deref().and_then(|data| {
        cover_cache_dir.and_then(|dir| metadata::cache_cover_thumbnail(data, source, dir))
    });
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
        channels: TARGET_CHANNELS,
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
        interrupt,
    })
}

/// 按已经打开的输出流采样率启动解码，避免为探测音源信息重复打开网络源
pub fn start_prepared_decode(
    prepared: PreparedDecoder,
    shared: Arc<Shared>,
) -> Result<(AudioMetadata, JoinHandle<DecoderData>)> {
    let PreparedDecoder {
        reader,
        mut metadata,
        replay_gain_db,
        interrupt,
    } = prepared;
    let target_rate = shared.sample_rate();
    let player_resampler = build_resampler(&reader, target_rate)?;
    metadata.sample_rate = target_rate;

    if let Some(db) = replay_gain_db {
        shared.set_normalization_gain(metadata::db_to_linear(db));
    }
    if let Some(handle) = &interrupt {
        shared.bind_interrupt(handle.clone());
    }

    let data = DecoderData {
        reader,
        player_resampler,
        interrupt,
    };

    let handle = thread::Builder::new()
        .name("audio-decoder".to_string())
        .spawn(move || {
            let mut data = data;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                run_decoding_loop(&mut data, &shared);
            }));
            if let Err(payload) = result {
                report_decoder_panic(payload, &shared);
            } else if !shared.is_decode_failed() && !shared.is_stopping() {
                shared.mark_eof();
            }
            data
        })
        .context("启动解码线程失败")?;

    Ok((metadata, handle))
}

/// 用已有的 DecoderData 继续解码（seek 后复用）
pub fn resume_decode(data: DecoderData, shared: Arc<Shared>) -> Result<JoinHandle<DecoderData>> {
    if let Some(interrupt) = data.interrupt_handle() {
        shared.bind_interrupt(interrupt);
    }
    thread::Builder::new()
        .name("audio-decoder".to_string())
        .spawn(move || {
            let mut data = data;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                run_decoding_loop(&mut data, &shared);
            }));
            if let Err(payload) = result {
                report_decoder_panic(payload, &shared);
            } else if !shared.is_decode_failed() && !shared.is_stopping() {
                shared.mark_eof();
            }
            data
        })
        .context("启动解码线程失败")
}

/// 根据 source 协议打开音频：http(s) 走延迟 Range 源，其他走本地 File
///
fn open_source(
    source: &str,
    interrupt: HttpInterrupt,
) -> Result<(AudioReader, Option<HttpInterrupt>)> {
    let (reader, cancel) = if source.starts_with("http://") || source.starts_with("https://") {
        let http = HttpRangeSource::new_with_interrupt(source, interrupt.clone())?;
        let reader =
            AudioReader::new(http).with_context(|| format!("打开网络音频失败: {source}"))?;
        (reader, Some(interrupt))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        let reader =
            AudioReader::new(file).with_context(|| format!("打开本地音频失败: {source}"))?;
        (reader, None)
    };

    Ok((reader, cancel))
}

fn build_resampler(reader: &AudioReader, target_rate: u32) -> Result<Resampler> {
    let player_opts = ResampleOptions::new()
        .sample_rate(target_rate as i32)
        .channels(i32::from(TARGET_CHANNELS))
        .format::<f32>();
    reader
        .build_resampler(player_opts)
        .with_context(|| "构建播放重采样器失败")
}

/// panic 只转换成内部故障，不允许沿正常 EOF 路径发出 ended。
fn report_decoder_panic(payload: Box<dyn std::any::Any + Send>, shared: &Shared) {
    let message = payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("non-string panic payload");
    error!(message, "解码线程发生内部 panic");
    shared.mark_internal_failed();
}

/// 将 resampler 的借用输出复制进受控回收池缓冲，避免每个音频 frame 调用 `to_vec()`。
fn take_resampled_output(data: &DecoderData, shared: &Shared) -> Vec<f32> {
    let output = data.player_resampler.output_as::<f32>();
    let mut samples = shared.take_recycled_buffer();
    samples.clear();
    samples.extend_from_slice(output);
    samples
}

/// 核心解码循环：每帧只经过一次输出重采样，FFT 使用同一输出 PCM。
fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new(shared.sample_rate(), TARGET_CHANNELS);
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
                if data.player_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("player resampler 处理失败，结束解码");
                    shared.mark_decode_failed();
                    return;
                }
                let mut player_samples = take_resampled_output(data, shared);

                // 重采样可能还在攒样本，本轮没出数据就跳过
                if player_samples.is_empty() {
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

                shared.push(AudioChunk { player_samples });
            }
            Ok(None) | Err(AudioError::Eof) => {
                // EOF flush：把重采样器内部残留挤出来，否则最后几十毫秒丢失
                let _ = data.player_resampler.process::<f32>(None);
                let player_samples = take_resampled_output(data, shared);
                if !player_samples.is_empty() {
                    shared.push(AudioChunk { player_samples });
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
