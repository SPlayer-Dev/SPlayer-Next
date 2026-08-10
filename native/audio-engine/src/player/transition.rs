use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::Result;
use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;
use rodio::Player as RodioPlayer;

use crate::audio_output::AudioOutput;
use crate::decoder;
use crate::equalizer::Equalizer;
use crate::metadata::AudioMetadata;
use crate::shared::Shared;
use crate::source::DecoderSource;
use crate::tempo::StretchProcessor;

use super::{InnerPlayer, PlayerEvent, PlayerState};

/// 切换/seek 时要 join 的旧线程集合，全部挪到 spawn_blocking 工作线程 join，
/// 主线程持锁阶段只 take handle，避免最坏 200ms+ 的卡顿
pub struct OldThreads {
    pub decoder_thread: Option<JoinHandle<decoder::DecoderData>>,
    pub position_timer: Option<JoinHandle<()>>,
    pub fft_timer: Option<JoinHandle<()>>,
    pub fade_handle: Option<JoinHandle<()>>,
}

impl OldThreads {
    /// 在工作线程上 join 所有旧 timer/fade，返回旧解码线程 handle 供调用方继续使用
    /// 忽略 join 错误：辅助线程 panic 不阻止新加载，主播放路径不依赖它们
    pub fn join_aux(self) -> Option<JoinHandle<decoder::DecoderData>> {
        for h in [self.position_timer, self.fft_timer, self.fade_handle]
            .into_iter()
            .flatten()
        {
            let _ = h.join();
        }
        self.decoder_thread
    }
}

/// async seek 阶段 1 的输出：带到工作线程做 join + ffmpeg seek + 重启解码
pub struct SeekTake {
    /// 所有旧线程 handle（工作线程 join）
    pub old_threads: OldThreads,
    /// 归一化开关（继承到新 Shared）
    pub normalization_enabled: bool,
    /// 归一化增益（继承到新 Shared）
    pub normalization_gain: f32,
    /// 当前音频源（seek 失败时 fallback 到 load）
    pub current_source: Option<String>,
    /// seek 前是否在播放（fallback 到 load 时保留状态）
    pub was_playing: bool,
    /// 当前输出设备采样率（新 Shared 沿用，与复用的重采样器目标一致）
    pub output_sample_rate: u32,
    /// 本次 seek 的 token，commit_seeked 时比对最新值，不一致说明已被新 load/seek/stop 取代
    pub token: u64,
    /// 解码侧 DSP 共享实例
    pub equalizer: Arc<Mutex<Equalizer>>,
    pub tempo: Arc<Mutex<StretchProcessor>>,
}

/// 完成音源准备后一次性提交给播放器的资源
pub struct LoadedPlayback {
    pub metadata: AudioMetadata,
    pub decode_handle: JoinHandle<decoder::DecoderData>,
    pub shared: Arc<Shared>,
    pub output: AudioOutput,
    pub cancel: Option<HttpCancelHandle>,
}

impl InnerPlayer {
    /// 给 NAPI 绑定层 async load 用：原子地发出停止信号 + take 所有旧线程 handle
    /// 调用方负责在工作线程 join 这些 handle，主线程持锁阶段不阻塞
    /// 返回旧输出流供工作线程在打开新流前释放；token 用于校验本次 load 是否已被取代
    pub fn take_for_async_load(
        &mut self,
        handle: HttpCancelHandle,
    ) -> (OldThreads, Option<AudioOutput>, u64) {
        // 自增 token：本次 load 的标识；任何并发的更早 commit_loaded 比较时会发现不匹配
        let token = self.load_token.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(previous) = self.pending_load_handle.replace(handle) {
            previous.cancel();
        }

        // 发停止信号（原子写，纳秒级）
        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }

        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        if let Some(ref shared) = self.shared {
            shared.drain_buffer();
        }
        self.shared = None;
        self.cover_raw = None;
        self.seek_base = 0.0;
        self.fft.reset();
        self.equalizer.lock().reset_state();
        self.tempo.lock().reset();

        let old_threads = OldThreads {
            decoder_thread: self.decoder_thread.take(),
            position_timer: self.position_timer_handle.take(),
            fft_timer: self.fft_timer_handle.take(),
            fade_handle: self.fade_handle.take(),
        };
        (old_threads, self.output.take(), token)
    }

    /// token 是否仍是最新值（seek 失败回退到 load 前校验，避免复活已被取代的旧源）
    pub fn is_load_token_current(&self, token: u64) -> bool {
        token == self.load_token.load(Ordering::Acquire)
    }

    /// 获取加载代次，用于工作线程在创建输出流前快速放弃已过期任务
    pub fn load_token_handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.load_token)
    }

    /// 获取解码侧共享均衡器
    pub fn equalizer_handle(&self) -> Arc<Mutex<Equalizer>> {
        Arc::clone(&self.equalizer)
    }

    /// 获取解码侧共享变速处理器
    pub fn tempo_handle(&self) -> Arc<Mutex<StretchProcessor>> {
        Arc::clone(&self.tempo)
    }

    /// 清理仍属于指定 load 的网络中断句柄
    pub fn clear_pending_load(&mut self, token: u64) {
        if self.is_load_token_current(token) {
            self.pending_load_handle = None;
        }
    }

    /// 给 NAPI 绑定层的异步 seek 使用：原子发出停止信号并取出所有旧线程句柄（不 join）
    ///
    /// 返回 None 表示当前没有解码线程（空闲 / 已停止 / 正在异步加载被 load 取走），
    /// 此时不做任何副作用——尤其不能 bump token，否则会误杀在途的 load
    pub fn take_for_async_seek(&mut self) -> Option<SeekTake> {
        self.decoder_thread.as_ref()?;

        // 与 load 共用同一 token 序列：commit_seeked 时比对，防止 seek 期间发生的
        // load/stop 完成后被本次 seek 的 commit 覆盖（旧曲复活 + 新解码线程泄漏）
        let token = self.load_token.fetch_add(1, Ordering::AcqRel) + 1;

        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }

        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let old_threads = OldThreads {
            decoder_thread: self.decoder_thread.take(),
            position_timer: self.position_timer_handle.take(),
            fft_timer: self.fft_timer_handle.take(),
            fade_handle: self.fade_handle.take(),
        };

        let (norm_enabled, norm_gain) = match self.shared.take() {
            Some(s) => {
                s.drain_buffer();
                (s.is_normalization_enabled(), s.normalization_gain())
            }
            None => (self.normalization_enabled, 0.0),
        };

        self.fft.reset();

        Some(SeekTake {
            old_threads,
            normalization_enabled: norm_enabled,
            normalization_gain: norm_gain,
            current_source: self.current_source.clone(),
            was_playing: self.state == PlayerState::Playing,
            output_sample_rate: self.output_sample_rate(),
            token,
            equalizer: Arc::clone(&self.equalizer),
            tempo: Arc::clone(&self.tempo),
        })
    }

    /// seek 三段式的最后一段：主线程持锁，attach 新 sink + 新解码线程
    ///
    /// 返回 false 表示本次 seek 已被更新的 load/seek/stop 取代，结果被丢弃
    pub fn commit_seeked(
        &mut self,
        token: u64,
        position_secs: f64,
        shared: Arc<Shared>,
        handle: JoinHandle<decoder::DecoderData>,
    ) -> Result<bool> {
        // 抢占检查：与 commit_loaded 同款，不一致则丢弃本次 seek 结果
        if token != self.load_token.load(Ordering::Acquire) {
            shared.stop();
            // 解码线程读到 stop 信号后自行退出，故意不 join 避免阻塞主线程持锁阶段
            drop(handle);
            return Ok(false);
        }

        let sink = {
            let output = self.ensure_output()?;
            Arc::new(RodioPlayer::connect_new(output.mixer()))
        };

        let sample_rate = shared.sample_rate();
        let decoder_source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::clone(&self.fft),
            sample_rate,
            self.audio_channels,
        );

        let was_paused = self.state == PlayerState::Paused;
        sink.set_volume(self.target_volume);
        if was_paused {
            sink.pause();
        }
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.audio_sample_rate = sample_rate;
        self.seek_base = position_secs;

        if was_paused {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        } else {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Playing,
            });
            self.start_position_timer();
            self.start_fft_timer();
        }

        Ok(true)
    }

    /// load 的下半部分：NAPI 绑定层完成异步 IO 后由主线程持锁调用
    ///
    /// `token` 为 take_for_async_load 时拿到的标识。本函数比对当前最新 token：
    /// - 不一致 → 本次 load 已被更新的 load 抢占，丢弃 sink/shared，stop 解码线程后返回 None
    /// - 一致 → 正常 attach 新资源
    pub fn commit_loaded(
        &mut self,
        token: u64,
        source: &str,
        auto_play: bool,
        loaded: LoadedPlayback,
    ) -> Result<Option<AudioMetadata>> {
        let LoadedPlayback {
            mut metadata,
            decode_handle,
            shared,
            output,
            cancel,
        } = loaded;
        // 抢占检查：比对最新 token，不等说明已有更新的 load 在路上 / 已 commit
        if token != self.load_token.load(Ordering::Acquire) {
            if let Some(h) = cancel {
                h.cancel();
            }
            // 停止新解码线程（它会写入 shared 但没人消费），让 join 能尽快返回
            shared.stop();
            // shared / sink / decode_handle 在此函数返回时 drop；解码线程读到 stop 信号后退出
            // decode_handle 故意不 join，避免阻塞主线程持锁阶段（让解码线程在后台自然结束）
            drop(decode_handle);
            return Ok(None);
        }

        self.pending_load_handle = cancel;
        self.output = Some(output);

        let sink = {
            let output = self.ensure_output()?;
            Arc::new(RodioPlayer::connect_new(output.mixer()))
        };

        let decoder_source = DecoderSource::new(
            Arc::clone(&shared),
            Arc::clone(&self.fft),
            metadata.sample_rate,
            metadata.channels,
        );

        sink.set_volume(self.target_volume);
        if !auto_play {
            sink.pause();
        }
        sink.append(decoder_source);

        self.sink = Some(sink);
        self.shared = Some(shared);
        self.decoder_thread = Some(decode_handle);
        self.seek_base = 0.0;
        self.current_source = Some(source.to_string());

        self.audio_sample_rate = metadata.sample_rate;
        self.audio_channels = metadata.channels;
        self.audio_duration = metadata.duration_secs;
        self.cover_raw = metadata.cover_raw.take();

        if auto_play {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Playing,
            });
            self.start_position_timer();
            self.start_fft_timer();
        } else {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        }

        Ok(Some(metadata))
    }
}
