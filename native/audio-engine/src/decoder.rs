use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::ChannelLayout;
use ffmpeg_next::Dictionary;
use parking_lot::{Condvar, Mutex};

use crate::metadata::{self, ExternalLyric};

/// 解码后的 PCM 音频数据块
pub struct AudioChunk {
    /// 交错排列的 f32 播放样本（L R L R ...）
    pub player_samples: Vec<f32>,
    /// 单声道 f32 样本，用于 FFT 频谱分析
    pub fft_samples: Vec<f32>,
}

/// 解码线程与播放迭代器之间的共享状态
pub struct Shared {
    buffer: Mutex<VecDeque<AudioChunk>>,
    condvar: Condvar,
    is_eof: AtomicBool,
    is_stopping: AtomicBool,
}

/// 共享缓冲区最大容量（背压阈值）
const FRAME_BUFFER_CAPACITY: usize = 64;

impl Shared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            condvar: Condvar::new(),
            is_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
        })
    }

    /// 推入数据块，缓冲区满时阻塞等待（背压）
    pub fn push(&self, chunk: AudioChunk) {
        let mut buf = self.buffer.lock();
        while buf.len() >= FRAME_BUFFER_CAPACITY && !self.is_stopping.load(Ordering::Acquire) {
            self.condvar.wait(&mut buf);
        }
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        buf.push_back(chunk);
        self.condvar.notify_one();
    }

    /// 弹出数据块，缓冲区空时阻塞等待。
    /// 仅在 EOF 或停止且缓冲区为空时返回 None。
    pub fn pop(&self) -> Option<AudioChunk> {
        let mut buf = self.buffer.lock();
        loop {
            if let Some(chunk) = buf.pop_front() {
                self.condvar.notify_one();
                return Some(chunk);
            }
            if self.is_eof.load(Ordering::Acquire) || self.is_stopping.load(Ordering::Acquire) {
                return None;
            }
            self.condvar.wait(&mut buf);
        }
    }

    /// 标记解码完成
    pub fn mark_eof(&self) {
        self.is_eof.store(true, Ordering::Release);
        self.condvar.notify_all();
    }

    /// 发出停止信号，唤醒双方
    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        self.condvar.notify_all();
    }

    /// 检查播放是否已结束（EOF 且缓冲区为空）
    pub fn is_done(&self) -> bool {
        let buf = self.buffer.lock();
        self.is_eof.load(Ordering::Acquire) && buf.is_empty()
    }
}

/// 音频元数据（包含封面路径和歌词）
#[derive(Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式名称（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词
    pub embedded_lyric: Option<String>,
    /// 同目录所有歌词文件
    pub external_lyrics: Vec<ExternalLyric>,
    /// 封面缩略图缓存路径（用于前端日常显示）
    pub cover: Option<String>,
}

/// 播放输出目标格式
const TARGET_SAMPLE_RATE: u32 = 48000;
const TARGET_CHANNELS: u16 = 2;
/// FFT 分析目标格式：单声道 44100Hz
pub const FFT_SAMPLE_RATE: u32 = 44100;

/// 网络流读取失败最大重试次数
const NETWORK_READ_RETRIES: u32 = 3;
/// 重试间隔（毫秒）
const NETWORK_RETRY_DELAY_MS: u64 = 500;

/// 解码会话所需的资源
struct DecoderData {
    input_ctx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Audio,
    audio_stream_index: usize,
    resampler: Option<ffmpeg::software::resampling::Context>,
    fft_resampler: Option<ffmpeg::software::resampling::Context>,
}

/// 启动解码线程，返回音频元数据和线程句柄。
///
/// - `cover_cache_dir`: 封面缓存目录，传 Some 时提取封面并写入缓存
pub fn start_decode(
    source: &str,
    shared: Arc<Shared>,
    cover_cache_dir: Option<&str>,
) -> Result<(AudioMetadata, JoinHandle<()>)> {
    let input_ctx = open_input(source)?;

    let stream = input_ctx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .context("No audio stream found")?;
    let audio_stream_index = stream.index();

    // 优先从流的 time_base 获取时长（更准确）
    let time_base = stream.time_base();
    let stream_duration = stream.duration();
    let duration_secs = if stream_duration > 0 {
        stream_duration as f64 * time_base.0 as f64 / time_base.1 as f64
    } else if input_ctx.duration() > 0 {
        input_ctx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE)
    } else {
        0.0
    };

    let metadata_dict = input_ctx.metadata();
    let title = metadata_dict.get("title").map(|s| s.to_string());
    let artist = metadata_dict.get("artist").map(|s| s.to_string());
    let album = metadata_dict.get("album").map(|s| s.to_string());

    // 在同一个 input_ctx 上提取封面和内嵌歌词（不需要重新打开文件）
    let cover = cover_cache_dir
        .and_then(|dir| metadata::extract_cover_thumbnail(&input_ctx, source, dir));
    let embedded_lyric = metadata::extract_embedded_lyric(&input_ctx);
    let external_lyrics = metadata::find_all_external_lyrics(source);

    // 音质信息
    let bit_rate = unsafe { (*stream.parameters().as_ptr()).bit_rate };
    let codec = ffmpeg::codec::decoder::find(stream.parameters().id())
        .map(|c| c.name().to_string())
        .unwrap_or_default();

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

    let metadata = AudioMetadata {
        title,
        artist,
        album,
        duration_secs,
        sample_rate: TARGET_SAMPLE_RATE,
        channels: TARGET_CHANNELS,
        bit_rate,
        codec,
        embedded_lyric,
        external_lyrics,
        cover,
    };

    let mut data = DecoderData {
        input_ctx,
        decoder,
        audio_stream_index,
        resampler,
        fft_resampler,
    };

    let handle = thread::spawn(move || {
        run_decoding_loop(&mut data, &shared);
        shared.mark_eof();
    });

    Ok((metadata, handle))
}

/// 从指定位置开始解码（seek 后重新解码）
pub fn seek_decode(source: &str, position_secs: f64, shared: &Shared) -> Result<()> {
    let mut input_ctx = open_input(source)?;

    // 使用开放范围的 seek（与参考实现一致）
    let ts = (position_secs * ffmpeg::ffi::AV_TIME_BASE as f64) as i64;
    if input_ctx.seek(ts, ..).is_err() {
        let _ = input_ctx.seek(ts, ..ts);
    }

    let stream = input_ctx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .context("No audio stream found")?;
    let audio_stream_index = stream.index();

    let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
    let decoder = decoder_ctx.decoder().audio()?;

    let src_format = decoder.format();
    let src_layout = decoder.channel_layout();
    let src_rate = decoder.rate();

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

    let mut data = DecoderData {
        input_ctx,
        decoder,
        audio_stream_index,
        resampler,
        fft_resampler,
    };

    run_decoding_loop(&mut data, shared);
    shared.mark_eof();
    Ok(())
}

/// 打开音频输入，网络地址自动启用 HTTP 重连
fn open_input(source: &str) -> Result<ffmpeg::format::context::Input> {
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

    loop {
        // 背压：缓冲区满时阻塞等待消费
        {
            let mut buf = shared.buffer.lock();
            while buf.len() >= FRAME_BUFFER_CAPACITY && !shared.is_stopping.load(Ordering::Acquire)
            {
                shared.condvar.wait(&mut buf);
            }
            if shared.is_stopping.load(Ordering::Acquire) {
                return;
            }
        }

        let mut decoded = ffmpeg::frame::Audio::empty();
        match data.decoder.receive_frame(&mut decoded) {
            Ok(_) => {
                consecutive_read_failures = 0;

                // 部分文件不设置 channel_layout，需要填默认值
                if decoded.channel_layout().is_empty() {
                    let default_layout = ChannelLayout::default(decoded.channels() as i32);
                    decoded.set_channel_layout(default_layout);
                }

                player_scratch.clear();
                fft_scratch.clear();

                resample_frame(data, &mut decoded, &mut player_scratch, &mut fft_scratch);

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
                continue;
            }
            Err(_) => {
                // 其他解码错误，重试后放弃
                consecutive_read_failures += 1;
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
