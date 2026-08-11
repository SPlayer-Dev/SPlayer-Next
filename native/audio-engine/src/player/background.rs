use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use rodio::Player as RodioPlayer;

use super::events::playback_completion_event;
use super::{InnerPlayer, PlayerEvent, PlayerState};

/// 渐变步数
const FADE_STEPS: u32 = 20;

/// 可取消的渐变：在独立线程中逐步调整音量，cancel 为 true 时提前退出
fn fade_volume(sink: &RodioPlayer, from: f32, to: f32, duration_ms: u64, cancel: &AtomicBool) {
    if duration_ms == 0 {
        sink.set_volume(to);
        return;
    }
    let step_duration = Duration::from_millis(duration_ms / u64::from(FADE_STEPS));
    for step in 1..=FADE_STEPS {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let progress = step as f32 / FADE_STEPS as f32;
        sink.set_volume(from + (to - from) * progress);
        // 分片可取消：渐变时长用户可配，长渐变的整步 sleep 会让 cancel_fade 的
        // 同步 join 卡住最长一个步长
        sleep_unless_stopped(cancel, step_duration);
    }
}

/// 分片 sleep：每 10ms 检查一次停止标志
/// 让 stop_*_timer 的同步 join（pause/stop 都在 NAPI 主线程调用）在 ~10ms 内返回，
/// 而不是阻塞整个推送周期（200ms）
fn sleep_unless_stopped(flag: &AtomicBool, total: Duration) {
    const SLICE: Duration = Duration::from_millis(10);
    let mut remaining = total;
    while !flag.load(Ordering::Relaxed) && !remaining.is_zero() {
        let step = remaining.min(SLICE);
        thread::sleep(step);
        remaining -= step;
    }
}

impl InnerPlayer {
    /// 取消正在进行的渐变，并等待渐变线程退出
    pub(super) fn cancel_fade(&mut self) {
        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = self.fade_handle.take() {
            let _ = handle.join();
        }
    }

    /// 启动非阻塞渐变（独立线程执行，不阻塞调用方）。
    /// 完成回调仅在未被取消时执行
    pub(super) fn start_fade(
        &mut self,
        from: f32,
        to: f32,
        on_complete: Option<Box<dyn FnOnce() + Send>>,
    ) {
        self.cancel_fade();

        let cancel = Arc::new(AtomicBool::new(false));
        self.fade_cancel = Some(Arc::clone(&cancel));

        if let Some(ref sink) = self.sink {
            let sink = Arc::clone(sink);
            let fade_ms = self.fade_duration_ms;
            let handle = thread::spawn(move || {
                fade_volume(&sink, from, to, fade_ms, &cancel);
                if !cancel.load(Ordering::Relaxed) {
                    if let Some(callback) = on_complete {
                        callback();
                    }
                }
            });
            self.fade_handle = Some(handle);
        }
    }

    /// 启动位置推送定时器（在独立线程中运行，每 200ms 推送一次位置）
    pub(super) fn start_position_timer(&mut self) {
        self.stop_position_timer();

        let stop_flag = Arc::new(AtomicBool::new(false));
        self.position_timer_stop = Some(Arc::clone(&stop_flag));

        let shared = match &self.shared {
            Some(s) => Arc::clone(s),
            None => return,
        };
        let cb = match &self.event_callback {
            Some(cb) => Arc::clone(cb),
            None => return,
        };
        let seek_base = self.seek_base;
        let duration = self.duration();

        let handle = thread::spawn(move || {
            // 停滞检测：消费计数连续 STALL_THRESHOLD_TICKS 次未变 + 缓冲区非空 → sink 静默死亡
            const STALL_THRESHOLD_TICKS: u32 = 6; // 6 * 200ms = 1.2s
            let mut last_consumed = shared.samples_consumed_count();
            let mut stall_ticks: u32 = 0;

            while !stop_flag.load(Ordering::Relaxed) {
                let consumed = shared.samples_consumed_count();
                let position = seek_base + shared.consumed_position();
                cb(PlayerEvent::Position { position, duration });

                // 检测播放结束：all_consumed 表示 rodio 侧已消费完所有数据
                if shared.is_all_consumed() {
                    // 解码因读取失败中止且距末尾尚远 → 音源失效，前端重新解析地址续播；
                    // 距末尾 3s 内的失败按正常结束处理——Content-Length 偏大的转码源
                    // 在曲尾必然提前 EOF，整曲重载只会带来一轮无意义抖动。
                    // duration 未知（直播流等）时无"末尾"概念，失败一律上报
                    cb(playback_completion_event(&shared, duration, position));
                    cb(PlayerEvent::StateChanged {
                        state: PlayerState::Stopped,
                    });
                    break;
                }

                // 缓冲区空时认为是解码 underrun，等待解码补数据，不视为停滞
                if consumed == last_consumed && !shared.is_buffer_empty() {
                    stall_ticks += 1;
                    if stall_ticks >= STALL_THRESHOLD_TICKS {
                        cb(PlayerEvent::OutputStalled);
                        // 发完归零，依赖主进程冷却防抖
                        stall_ticks = 0;
                    }
                } else {
                    stall_ticks = 0;
                }
                last_consumed = consumed;

                sleep_unless_stopped(&stop_flag, Duration::from_millis(200));
            }
        });
        self.position_timer_handle = Some(handle);
    }

    /// 停止位置推送定时器，等待线程退出
    pub(super) fn stop_position_timer(&mut self) {
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = self.position_timer_handle.take() {
            let _ = handle.join();
        }
    }

    /// 启动 FFT 推送定时器（独立线程，每 50ms 推送一次频谱数据）
    pub(super) fn start_fft_timer(&mut self) {
        self.stop_fft_timer();
        if !self.fft_enabled() {
            return;
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        self.fft_timer_stop = Some(Arc::clone(&stop_flag));

        let fft_enabled = Arc::clone(&self.fft_enabled);
        let fft = Arc::clone(&self.fft);
        let cb = match &self.event_callback {
            Some(cb) => Arc::clone(cb),
            None => return,
        };

        let handle = thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                if fft_enabled.load(Ordering::Relaxed) {
                    let (ldata, rdata) = fft.analyze();
                    cb(PlayerEvent::FftData { ldata, rdata });
                }
                sleep_unless_stopped(&stop_flag, Duration::from_millis(50));
            }
        });
        self.fft_timer_handle = Some(handle);
    }

    /// 停止 FFT 推送定时器，等待线程退出
    pub(super) fn stop_fft_timer(&mut self) {
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = self.fft_timer_handle.take() {
            let _ = handle.join();
        }
    }

    /// 设置 FFT 推送开关
    pub fn set_fft_enabled(&mut self, enabled: bool) {
        self.fft_enabled.store(enabled, Ordering::Relaxed);
        self.fft.set_enabled(enabled);
        if enabled && self.state == PlayerState::Playing {
            self.start_fft_timer();
        } else if !enabled {
            self.stop_fft_timer();
        }
    }

    /// 获取 FFT 推送开关状态
    pub fn fft_enabled(&self) -> bool {
        self.fft_enabled.load(Ordering::Relaxed)
    }
}
