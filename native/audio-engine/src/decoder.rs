use std::sync::Arc;
use std::thread::{self, JoinHandle};

use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::ChannelLayout;
use ffmpeg_next::Dictionary;
use tracing::{debug, warn};

use crate::loudness::LoudnessAnalyzer;
use crate::metadata;
use crate::shared::{AudioChunk, AudioMetadata, Shared};

/// 播放输出目标格式
pub const TARGET_SAMPLE_RATE: u32 = 48000;
pub const TARGET_CHANNELS: u16 = 2;
/// FFT 分析目标格式：单声道 44100Hz
pub const FFT_SAMPLE_RATE: u32 = 44100;

/// 网络流读取失败最大重试次数
const NETWORK_READ_RETRIES: u32 = 3;
/// 重试间隔（毫秒）
const NETWORK_RETRY_DELAY_MS: u64 = 500;


/// 解码会话所需的资源（跨 seek 复用，避免重建 FFmpeg 上下文）
pub struct DecoderData {
    input_ctx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Audio,
    audio_stream_index: usize,
    resampler: Option<ffmpeg::software::resampling::Context>,
    fft_resampler: Option<ffmpeg::software::resampling::Context>,
}

impl DecoderData {
    /// 在已有上下文上 seek + flush，不重新打开文件
    /// 返回 false 表示 seek 失败，调用方应回退到完整 load
    pub fn seek(&mut self, position_secs: f64) -> bool {
        let ts = (position_secs * ffmpeg::ffi::AV_TIME_BASE as f64) as i64;
        let ok = self.input_ctx.seek(ts, ..).is_ok()
            || self.input_ctx.seek(ts, ..ts).is_ok();
        if ok {
            // 清空解码器内部缓冲区
            // SAFETY: decoder 内部持有有效的 AVCodecContext 指针
            unsafe {
                ffmpeg::ffi::avcodec_flush_buffers(self.decoder.as_mut_ptr());
            }
        }
        ok
    }
}

// SAFETY: DecoderData 的所有字段（FFmpeg C 指针的 Rust wrapper）
// 仅被单一线程独占使用，在 spawn 时 move 进线程，不存在并发访问。
unsafe impl Send for DecoderData {}

/// 启动解码线程，返回音频元数据和线程句柄。
///
/// 线程结束时返回 `DecoderData`，调用方可通过 `handle.join()` 回收并复用于后续 seek，
/// 避免重建 FFmpeg 上下文。
///
/// - `cover_cache_dir`: 封面缓存目录，传 Some 时提取封面并写入缓存
pub fn start_decode(
    source: &str,
    shared: Arc<Shared>,
    cover_cache_dir: Option<&str>,
) -> Result<(AudioMetadata, JoinHandle<DecoderData>)> {
    let input_ctx = open_input(source)?;

    let stream = input_ctx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .context("No audio stream found")?;
    let audio_stream_index = stream.index();

    // 时长：优先从流的 time_base 获取
    let time_base = stream.time_base();
    let stream_duration = stream.duration();
    let duration_secs = if stream_duration > 0 {
        stream_duration as f64 * time_base.0 as f64 / time_base.1 as f64
    } else if input_ctx.duration() > 0 {
        input_ctx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE)
    } else {
        0.0
    };

    let tags = metadata::extract_tags(&input_ctx);

    // SAFETY: input_ctx 在此作用域内有效，stream 引用自 input_ctx
    let stream_info = unsafe { metadata::extract_stream_info(&stream, &input_ctx) };
    let codec = ffmpeg::codec::decoder::find(stream.parameters().id())
        .map(|c| c.name().to_string())
        .unwrap_or_default();

    let cover =
        cover_cache_dir.and_then(|dir| metadata::extract_cover_thumbnail(&input_ctx, source, dir));
    let cover_raw = metadata::read_attached_pic(&input_ctx);
    let embedded_lyric = metadata::extract_embedded_lyric(&input_ctx);
    let external_lyrics = metadata::find_all_external_lyrics(source);
    let replay_gain_db = metadata::extract_replay_gain(&input_ctx);

    let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
    let decoder = decoder_ctx.decoder().audio()?;

    let src_format = decoder.format();
    let src_layout = decoder.channel_layout();
    let src_rate = decoder.rate();

    // 使用平面 F32 格式输出（与参考实现一致）
    let target_format = ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar);
    let target_layout = ChannelLayout::default(TARGET_CHANNELS as i32);

    let resampler = create_resampler(
        src_format,
        src_layout,
        src_rate,
        target_format,
        target_layout,
        TARGET_SAMPLE_RATE,
    )?;

    let fft_resampler = create_resampler(
        src_format,
        src_layout,
        src_rate,
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
        ChannelLayout::MONO,
        FFT_SAMPLE_RATE,
    )?;

    // 设置归一化增益：有 ReplayGain tag 时直接使用，否则由实时分析器动态计算
    if let Some(db) = replay_gain_db {
        shared.set_normalization_gain(metadata::db_to_linear(db));
    }

    let metadata = AudioMetadata {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        comment: tags.comment,
        duration_secs,
        sample_rate: TARGET_SAMPLE_RATE,
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

    let data = DecoderData {
        input_ctx,
        decoder,
        audio_stream_index,
        resampler,
        fft_resampler,
    };

    let handle = thread::spawn(move || {
        let mut data = data;
        run_decoding_loop(&mut data, &shared);
        shared.mark_eof();
        data
    });

    Ok((metadata, handle))
}

/// 用已有的 DecoderData 继续解码（seek 后复用）
pub fn resume_decode(data: DecoderData, shared: Arc<Shared>) -> JoinHandle<DecoderData> {
    thread::spawn(move || {
        let mut data = data;
        run_decoding_loop(&mut data, &shared);
        shared.mark_eof();
        data
    })
}

/// 打开音频输入，网络地址自动启用 HTTP 重连
fn open_input(source: &str) -> Result<ffmpeg::format::context::Input> {
    debug!(source, "打开音频输入");
    let is_network = source.starts_with("http://") || source.starts_with("https://");

    if is_network {
        let mut opts = Dictionary::new();
        opts.set("reconnect", "1");
        opts.set("reconnect_streamed", "1");
        opts.set("reconnect_delay_max", "5");
        ffmpeg::format::input_with_dictionary(source, opts)
            .with_context(|| format!("Failed to open: {source}"))
    } else {
        ffmpeg::format::input(source).with_context(|| format!("Failed to open: {source}"))
    }
}

/// 仅在格式/声道/采样率不同时创建重采样器
fn create_resampler(
    src_format: ffmpeg::format::Sample,
    src_layout: ChannelLayout,
    src_rate: u32,
    target_format: ffmpeg::format::Sample,
    target_layout: ChannelLayout,
    target_rate: u32,
) -> Result<Option<ffmpeg::software::resampling::Context>> {
    if src_format != target_format || src_layout != target_layout || src_rate != target_rate {
        let resampler = ffmpeg::software::resampling::Context::get(
            src_format,
            src_layout,
            src_rate,
            target_format,
            target_layout,
            target_rate,
        )?;
        Ok(Some(resampler))
    } else {
        Ok(None)
    }
}

/// 核心解码循环
fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    let mut player_scratch = Vec::new();
    let mut fft_scratch = Vec::new();
    let mut eof_sent = false;
    let mut consecutive_read_failures: u32 = 0;

    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new();
    loudness.set_has_replay_gain(has_replay_gain);

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }

        let mut decoded = ffmpeg::frame::Audio::empty();
        match data.decoder.receive_frame(&mut decoded) {
            Ok(()) => {
                consecutive_read_failures = 0;

                // 部分文件不设置 channel_layout，需要填默认值
                if decoded.channel_layout().is_empty() {
                    let default_layout = ChannelLayout::default(decoded.channels() as i32);
                    decoded.set_channel_layout(default_layout);
                }

                player_scratch.clear();
                fft_scratch.clear();

                resample_frame(data, &mut decoded, &mut player_scratch, &mut fft_scratch);

                // 音量归一化
                if shared.is_normalization_enabled() {
                    let gain = if has_replay_gain {
                        // 有 ReplayGain 标签：用固定增益
                        shared.normalization_gain()
                    } else {
                        // 无标签：实时分析动态增益
                        loudness.process(&player_scratch)
                    };
                    if (gain - 1.0).abs() > f32::EPSILON {
                        for sample in &mut player_scratch {
                            *sample *= gain;
                        }
                    }
                }

                let chunk = AudioChunk {
                    player_samples: std::mem::take(&mut player_scratch),
                    fft_samples: std::mem::take(&mut fft_scratch),
                };

                shared.push(chunk);
            }
            Err(ffmpeg::Error::Eof) => {
                return;
            }
            Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::ffi::EAGAIN => {
                if eof_sent {
                    // 已发送 EOF，解码器清空完毕
                    return;
                }

                // 读取下一个数据包
                match data.input_ctx.packets().next() {
                    Some((stream, packet)) if stream.index() == data.audio_stream_index => {
                        consecutive_read_failures = 0;
                        if data.decoder.send_packet(&packet).is_err() {
                            return;
                        }
                    }
                    None => {
                        // 未读到数据包：可能是真正的文件结束，也可能是网络中断
                        consecutive_read_failures += 1;

                        if consecutive_read_failures <= NETWORK_READ_RETRIES {
                            // 网络流可能恢复，等待后重试
                            std::thread::sleep(std::time::Duration::from_millis(
                                NETWORK_RETRY_DELAY_MS,
                            ));
                            continue;
                        }

                        // 重试耗尽，刷新解码器
                        let _ = data.decoder.send_eof();
                        eof_sent = true;
                    }
                    _ => {
                        // 非音频包，跳过
                    }
                }
            }
            Err(err) => {
                // 其他解码错误，重试后放弃
                consecutive_read_failures += 1;
                warn!(error = %err, retries = consecutive_read_failures, "解码错误");
                if consecutive_read_failures <= NETWORK_READ_RETRIES {
                    std::thread::sleep(std::time::Duration::from_millis(NETWORK_RETRY_DELAY_MS));
                    continue;
                }
                return;
            }
        }
    }
}

/// 对解码帧进行重采样，分别输出播放数据和 FFT 数据
fn resample_frame(
    data: &mut DecoderData,
    decoded: &mut ffmpeg::frame::Audio,
    player_buf: &mut Vec<f32>,
    fft_buf: &mut Vec<f32>,
) {
    // 播放重采样
    if let Some(ref mut resampler) = data.resampler {
        if let Some(frame) = try_resample(resampler, decoded) {
            interleave_planar_frame(player_buf, &frame, frame.samples());
        }
    } else {
        interleave_planar_frame(player_buf, decoded, decoded.samples());
    }

    // FFT 重采样（单声道）
    if let Some(ref mut resampler) = data.fft_resampler {
        if let Some(frame) = try_resample(resampler, decoded) {
            let samples = frame.samples();
            if samples > 0 {
                fft_buf.extend_from_slice(&frame.plane::<f32>(0)[..samples]);
            }
        }
    } else {
        let samples = decoded.samples();
        if samples > 0 {
            fft_buf.extend_from_slice(&decoded.plane::<f32>(0)[..samples]);
        }
    }
}

/// 执行重采样，为每次调用创建正确尺寸的输出帧
fn try_resample(
    resampler: &mut ffmpeg::software::resampling::Context,
    decoded: &ffmpeg::frame::Audio,
) -> Option<ffmpeg::frame::Audio> {
    let output_samples = (decoded.samples() as f64 * resampler.output().rate as f64
        / decoded.rate() as f64)
        .ceil() as usize;

    let mut output_frame = ffmpeg::frame::Audio::new(
        resampler.output().format,
        output_samples,
        resampler.output().channel_layout,
    );

    if resampler.run(decoded, &mut output_frame).is_ok() {
        Some(output_frame)
    } else {
        None
    }
}

/// 将平面格式（L L L... R R R...）转为交错格式（L R L R ...）
fn interleave_planar_frame(
    sample_buffer: &mut Vec<f32>,
    frame: &ffmpeg::frame::Audio,
    samples_written: usize,
) {
    if samples_written == 0 {
        return;
    }
    let left_plane = &frame.plane::<f32>(0)[..samples_written];

    if frame.channels() >= 2 {
        let right_plane = &frame.plane::<f32>(1)[..samples_written];
        let interleaved = left_plane
            .iter()
            .zip(right_plane.iter())
            .flat_map(|(&l, &r)| [l, r]);
        sample_buffer.extend(interleaved);
    } else {
        sample_buffer.extend(left_plane.iter().copied());
    }
}
