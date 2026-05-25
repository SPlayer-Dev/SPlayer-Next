use std::fs::File;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use ffmpeg_audio::{AudioError, AudioReader};
use tracing::warn;

use crate::http_source;
use crate::loudness::LoudnessAnalyzer;
use crate::metadata;
use crate::shared::{AudioChunk, AudioMetadata, Shared};

/// 播放输出目标格式（重采样后送入 rodio）
pub const TARGET_SAMPLE_RATE: u32 = 48000;
pub const TARGET_CHANNELS: u16 = 2;

/// 解码会话所需的资源（跨 seek 复用，避免重建 ffmpeg_audio 上下文）
pub struct DecoderData {
    reader: AudioReader,
    /// 中断标志：仅网络源持有；本地 File 不会长时间阻塞，没必要绑
    /// 通过 shared.bind_interrupt 注入，外部 stop() 触发后 HttpRangeSource::read 会返回 Interrupted
    interrupt_flag: Option<Arc<AtomicBool>>,
}

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    pub fn seek(&mut self, position_secs: f64) -> bool {
        self.reader
            .seek(Duration::from_secs_f64(position_secs))
            .is_ok()
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

// SAFETY: AudioReader 内部持有 ffmpeg C 指针，仅被解码线程独占使用，spawn 时 move 进线程
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
    let (reader, interrupt_flag) = open_source(source)?;
    if let Some(ref flag) = interrupt_flag {
        shared.bind_interrupt(Arc::clone(flag));
    }

    let info = reader.source_info();
    let duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let stream_info = metadata::extract_stream_info(info);
    let codec = info.codec_name.clone();

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
fn open_source(source: &str) -> Result<(AudioReader, Option<Arc<AtomicBool>>)> {
    if http_source::is_network_source(source) {
        let http = http_source::HttpRangeSource::new(source)?;
        let cancel = http.cancel_handle();
        let reader = AudioReader::new(http, TARGET_SAMPLE_RATE as i32, TARGET_CHANNELS as i32)
            .with_context(|| format!("打开网络音频失败: {source}"))?;
        Ok((reader, Some(cancel)))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        let reader = AudioReader::new(file, TARGET_SAMPLE_RATE as i32, TARGET_CHANNELS as i32)
            .with_context(|| format!("打开本地音频失败: {source}"))?;
        Ok((reader, None))
    }
}

/// 核心解码循环：从 reader 拉交错 stereo f32，按 chunk 推入 shared
fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let has_replay_gain = (shared.normalization_gain() - 1.0).abs() > f32::EPSILON;
    let mut loudness = LoudnessAnalyzer::new();
    loudness.set_has_replay_gain(has_replay_gain);

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }

        let samples = match data.reader.receive_frame() {
            Ok(Some(s)) => s.to_vec(),
            Ok(None) => return,
            Err(AudioError::Eof) => return,
            Err(e) => {
                warn!(error = %e, "解码失败");
                shared.mark_decode_failed();
                return;
            }
        };

        if samples.is_empty() {
            continue;
        }

        let mut player_samples = samples;

        // FFT 取左声道（48k mono），fft.rs 直接用 TARGET_SAMPLE_RATE 不再单独重采样
        let fft_samples: Vec<f32> = player_samples.chunks_exact(2).map(|c| c[0]).collect();

        if shared.is_normalization_enabled() {
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
}
