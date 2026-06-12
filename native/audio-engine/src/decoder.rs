use std::fs::File;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use ffmpeg_audio::{sys, AudioError, AudioReader, ResampleOptions, Resampler};
use tracing::debug;

use crate::http_source;
use crate::loudness::LoudnessAnalyzer;
use crate::metadata;
use crate::shared::{AudioChunk, AudioMetadata, Shared};

/// 播放输出目标格式（重采样后送入 rodio）
pub const TARGET_SAMPLE_RATE: u32 = 48000;
pub const TARGET_CHANNELS: u16 = 2;

/// 自定义 IO 源（HttpRangeSource / File）读取失败时，ffmpeg_audio 的 read 回调统一映射为此错误码
const AVERROR_EIO: i32 = sys::averror(libc::EIO);

/// 解码会话所需的资源（跨 seek 复用，避免重建 ffmpeg_audio 上下文）
///
/// 1-to-N 分发：同一帧零拷贝喂给两个重采样器
/// - player_resampler: 48k stereo f32，给 rodio 播放
/// - fft_resampler:    48k mono   f32，给 FFT 频谱分析
pub struct DecoderData {
    reader: AudioReader,
    player_resampler: Resampler,
    fft_resampler: Resampler,
    /// 中断标志：仅网络源持有；本地 File 不会长时间阻塞，没必要绑
    /// 通过 shared.bind_interrupt 注入，外部 stop() 触发后 HttpRangeSource::read 会返回 Interrupted
    interrupt_flag: Option<Arc<AtomicBool>>,
}

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    ///
    /// seek 后两个重采样器要 flush 掉残留样本，否则播放/FFT 会带上上一段尾巴
    pub fn seek(&mut self, position_secs: f64) -> bool {
        if self
            .reader
            .seek(Duration::from_secs_f64(position_secs))
            .is_err()
        {
            return false;
        }
        let _ = self.player_resampler.flush();
        let _ = self.fft_resampler.flush();
        true
    }

    /// 清除中断标志：seek 路径在 join 旧解码线程后调用一次，避免 stop 信号导致 seek 自爆
    pub fn reset_interrupt(&self) {
        if let Some(ref flag) = self.interrupt_flag {
            flag.store(false, Ordering::Release);
        }
    }

    /// 拿中断标志的 Arc clone：resume_decode 后需把它绑到新 shared
    pub fn interrupt_handle(&self) -> Option<Arc<AtomicBool>> {
        self.interrupt_flag.clone()
    }
}

// SAFETY: AudioReader/Resampler 内部持有 ffmpeg C 指针，仅被解码线程独占使用，spawn 时 move 进线程
unsafe impl Send for DecoderData {}

/// 启动解码线程，返回音频元数据和线程句柄
///
/// 线程结束时返回 `DecoderData`，调用方可通过 `handle.join()` 回收并复用于后续 seek，
/// 避免重建 ffmpeg_audio 上下文。
pub fn start_decode(
    source: &str,
    shared: Arc<Shared>,
    cover_cache_dir: Option<&str>,
) -> Result<(AudioMetadata, JoinHandle<DecoderData>)> {
    let (reader, player_resampler, fft_resampler, interrupt_flag) = open_source(source)?;
    if let Some(ref flag) = interrupt_flag {
        shared.bind_interrupt(Arc::clone(flag));
    }

    let info = reader.source_info();
    let duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let stream_info = metadata::extract_stream_info(info);
    let codec = info.codec_name.clone().unwrap_or_default();

    let raw_metadata = reader.metadata();
    let tags = metadata::extract_tags(&raw_metadata);
    let cover =
        cover_cache_dir.and_then(|dir| metadata::extract_cover_thumbnail(&reader, source, dir));
    let cover_raw = metadata::read_attached_pic(&reader);
    let embedded_lyric = metadata::extract_embedded_lyric(&raw_metadata);
    let external_lyrics = metadata::find_all_external_lyrics(source);
    let replay_gain_db = metadata::extract_replay_gain(&raw_metadata);

    // 有 ReplayGain tag 时设固定增益，否则由实时分析器动态计算
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
        reader,
        player_resampler,
        fft_resampler,
        interrupt_flag,
    };

    let handle = thread::spawn(move || {
        let mut data = data;
        // panic 兜底：让 mark_eof 一定被调到，避免前端永远收不到 ended 卡死
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_decoding_loop(&mut data, &shared);
        }));
        shared.mark_eof();
        data
    });

    Ok((metadata, handle))
}

/// 用已有的 DecoderData 继续解码（seek 后复用）
pub fn resume_decode(data: DecoderData, shared: Arc<Shared>) -> JoinHandle<DecoderData> {
    if let Some(flag) = data.interrupt_handle() {
        shared.bind_interrupt(flag);
    }
    thread::spawn(move || {
        let mut data = data;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_decoding_loop(&mut data, &shared);
        }));
        shared.mark_eof();
        data
    })
}

/// 根据 source 协议打开音频：http(s) 走 HttpRangeSource + 拿 cancel flag，其他走本地 File
///
/// 返回 (reader, 播放重采样器, FFT 重采样器, cancel 标志)
fn open_source(
    source: &str,
) -> Result<(AudioReader, Resampler, Resampler, Option<Arc<AtomicBool>>)> {
    let (reader, cancel) = if http_source::is_network_source(source) {
        let http = http_source::HttpRangeSource::new(source)?;
        let cancel = http.cancel_handle();
        let reader =
            AudioReader::new(http).with_context(|| format!("打开网络音频失败: {source}"))?;
        (reader, Some(cancel))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        let reader =
            AudioReader::new(file).with_context(|| format!("打开本地音频失败: {source}"))?;
        (reader, None)
    };

    let player_opts = ResampleOptions::new()
        .sample_rate(TARGET_SAMPLE_RATE as i32)
        .channels(i32::from(TARGET_CHANNELS))
        .format::<f32>();
    let player_resampler = reader
        .build_resampler(player_opts)
        .with_context(|| "构建播放重采样器失败")?;

    // FFT 用 mono：让 ffmpeg 做正经下混，比之前 chunks_exact(2).map(|c| c[0]) 抽左声道更合理
    let fft_opts = ResampleOptions::new()
        .sample_rate(TARGET_SAMPLE_RATE as i32)
        .channels(1)
        .format::<f32>();
    let fft_resampler = reader
        .build_resampler(fft_opts)
        .with_context(|| "构建 FFT 重采样器失败")?;

    Ok((reader, player_resampler, fft_resampler, cancel))
}

/// 核心解码循环：每帧解码一次，零拷贝分发到播放 + FFT 两个重采样器
fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new(TARGET_SAMPLE_RATE, TARGET_CHANNELS);
    loudness.set_has_replay_gain(has_replay_gain);

    // 容忍尾部坏帧（FLAC ID3v1 尾巴 / 封面 chunk / VBR 末帧），避免整首歌被标记 SourceError。
    // 该容忍只适用于数据层错误；IO 层错误（网络中断 / URL 过期）无论何时发生都必须上报，
    // 否则中途网络死亡会被当成正常播完，前端误跳下一曲而不是重新解析播放地址
    let mut had_success = false;

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }

        match data.reader.receive_frame() {
            Ok(Some(frame)) => {
                // 1-to-N：同一帧顺序喂两个重采样器
                if data.player_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("player resampler 处理失败，结束解码");
                    if !had_success {
                        shared.mark_decode_failed();
                    }
                    return;
                }
                let mut player_samples = data.player_resampler.output_as::<f32>().to_vec();

                if data.fft_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("fft resampler 处理失败，结束解码");
                    return;
                }
                let fft_samples = data.fft_resampler.output_as::<f32>().to_vec();

                // 重采样可能还在攒样本，本轮没出数据就跳过
                if player_samples.is_empty() && fft_samples.is_empty() {
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
                    player_samples,
                    fft_samples,
                });
            }
            Ok(None) | Err(AudioError::Eof) => {
                // EOF flush：把两个重采样器内部残留挤出来，否则最后几十毫秒丢
                let _ = data.player_resampler.process::<f32>(None);
                let _ = data.fft_resampler.process::<f32>(None);
                let player_samples = data.player_resampler.output_as::<f32>().to_vec();
                let fft_samples = data.fft_resampler.output_as::<f32>().to_vec();
                if !player_samples.is_empty() || !fft_samples.is_empty() {
                    shared.push(AudioChunk {
                        player_samples,
                        fft_samples,
                    });
                }
                return;
            }
            Err(e) => {
                // stop/切歌触发的中断（interrupt flag / HttpRangeSource cancel）不是源故障
                if shared.is_stopping() {
                    debug!(error = %e, "解码线程因停止信号退出");
                    return;
                }
                // HttpRangeSource 内部重试耗尽后以 io::Error 浮出，经 ffmpeg_audio 的
                // read 回调映射为 AVERROR(EIO)
                let io_failure = match &e {
                    AudioError::Io(_) => true,
                    AudioError::FFmpeg(code, _) => *code == AVERROR_EIO,
                    _ => false,
                };
                if io_failure || !had_success {
                    shared.mark_decode_failed();
                }
                debug!(error = %e, had_success, io_failure, "解码线程异常结束");
                return;
            }
        }
    }
}
