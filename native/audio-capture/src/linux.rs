//! Linux 采集后端：通过 PulseAudio 客户端 API 采集
//! （服务器为 PulseAudio，或 PipeWire 的 pipewire-pulse 兼容实现）
//! 系统声音采集默认 sink 的 monitor source，麦克风采集默认 capture source；
//! 请求服务端重采样为 8 kHz 单声道 f32，直接灌入 CaptureSink

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use libpulse_binding::callbacks::ListResult;
use libpulse_binding::context::{Context, FlagSet as ContextFlagSet, State as ContextState};
use libpulse_binding::def::BufferAttr;
use libpulse_binding::mainloop::standard::Mainloop;
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::{
    FlagSet as StreamFlagSet, PeekResult, State as StreamState, Stream,
};
use libpulse_binding::time::MicroSeconds;

use super::backend::{
    BackendError, CaptureBackend, CaptureConfig, CaptureSink, CaptureSource, TARGET_SAMPLE_RATE,
};

/// 主循环轮询超时（微秒）：保证取消响应延迟有上界，同时避免忙轮询
const POLL_TIMEOUT_US: u64 = 100_000;
/// 连接服务器 / 采集流就绪的等待上限
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 请求的采集分片大小（字节），8 kHz f32 单声道下约 1024 帧
const FRAG_SIZE_BYTES: u32 = 4096;

/// Linux 无 COM，返回空守卫（仅满足 init_com 的签名）
pub struct NoopComGuard;

impl Drop for NoopComGuard {
    fn drop(&mut self) {}
}

pub fn platform_supported() -> bool {
    true
}

pub fn init_com() -> Result<NoopComGuard, BackendError> {
    Ok(NoopComGuard)
}

/// Linux 采集后端：不持有跨线程共享状态，cancel 仅翻转原子标记，
/// 主循环在 run 中创建并只在本线程使用（standard::Mainloop 非 Send）
pub struct LinuxBackend {
    source: CaptureSource,
    cancelled: Arc<AtomicBool>,
    duration_ms: u32,
}

impl CaptureBackend for LinuxBackend {
    fn sample_rate(&self) -> u32 {
        TARGET_SAMPLE_RATE
    }

    fn run(&self, sink: &mut CaptureSink) -> Result<(), BackendError> {
        let mut mainloop = Mainloop::new()
            .ok_or_else(|| BackendError::CaptureFailed("创建事件循环失败".into()))?;
        let mut context = Context::new(&mainloop, "splayer-audio-capture")
            .ok_or_else(|| BackendError::CaptureFailed("创建连接上下文失败".into()))?;
        context
            .connect(None, ContextFlagSet::NOFLAGS, None)
            .map_err(|e| BackendError::CaptureFailed(format!("连接 PulseAudio 失败: {e}")))?;
        wait_context_ready(&mut mainloop, &mut context)?;

        let device: Option<String> = match self.source {
            CaptureSource::System => Some(resolve_monitor_source(&mut mainloop, &mut context)?),
            CaptureSource::Microphone => None,
        };

        let spec = Spec {
            format: Format::F32le,
            rate: TARGET_SAMPLE_RATE,
            channels: 1,
        };
        let mut stream = Stream::new(&mut context, "splayer-recognition", &spec, None)
            .ok_or_else(|| BackendError::CaptureFailed("创建采集流失败".into()))?;
        let attr = BufferAttr {
            maxlength: u32::MAX,
            fragsize: FRAG_SIZE_BYTES,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
        };
        stream
            .connect_record(device.as_deref(), Some(&attr), StreamFlagSet::NOFLAGS)
            .map_err(|e| BackendError::CaptureFailed(format!("连接采集源失败: {e}")))?;
        wait_stream_ready(&mut mainloop, &stream)?;

        let deadline = Instant::now() + Duration::from_millis(self.duration_ms as u64);
        let mut pushed = false;
        loop {
            if self.cancelled.load(Ordering::Acquire) || sink.ready() {
                break;
            }
            if Instant::now() >= deadline {
                sink.pad_to_target();
                break;
            }
            pump(&mut mainloop)?;
            if stream.get_state() != StreamState::Ready {
                // 流中断：已有数据则补齐后按部分采集处理，否则报错
                if pushed {
                    sink.pad_to_target();
                    break;
                }
                return Err(BackendError::CaptureFailed("采集流中断".into()));
            }
            loop {
                match stream.peek() {
                    Ok(PeekResult::Data(data)) => {
                        let mono = pcm_f32(data);
                        stream
                            .discard()
                            .map_err(|e| BackendError::CaptureFailed(format!("{e}")))?;
                        sink.push_mono(&mono);
                        pushed = true;
                    }
                    Ok(PeekResult::Hole(_)) => {
                        stream
                            .discard()
                            .map_err(|e| BackendError::CaptureFailed(format!("{e}")))?;
                    }
                    Ok(PeekResult::Empty) => break,
                    Err(e) => return Err(BackendError::CaptureFailed(format!("{e}"))),
                }
            }
        }
        let _ = stream.disconnect();
        context.disconnect();
        Ok(())
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

pub fn open_backend(
    config: &CaptureConfig,
    cancelled: Arc<AtomicBool>,
) -> Result<Arc<dyn CaptureBackend>, BackendError> {
    Ok(Arc::new(LinuxBackend {
        source: config.source,
        cancelled,
        duration_ms: config.duration_ms.clamp(3_000, 12_000),
    }))
}

/// 驱动一次主循环迭代：prepare 设置超时，poll 等待事件，dispatch 分发回调
fn pump(mainloop: &mut Mainloop) -> Result<(), BackendError> {
    mainloop
        .prepare(Some(MicroSeconds(POLL_TIMEOUT_US)))
        .map_err(|e| BackendError::CaptureFailed(format!("准备主循环失败: {e}")))?;
    mainloop
        .poll()
        .map_err(|e| BackendError::CaptureFailed(format!("主循环 poll 失败: {e}")))?;
    mainloop
        .dispatch()
        .map_err(|e| BackendError::CaptureFailed(format!("主循环 dispatch 失败: {e}")))?;
    Ok(())
}

/// 等待上下文就绪，连接不上视为无可用音频服务
fn wait_context_ready(mainloop: &mut Mainloop, context: &mut Context) -> Result<(), BackendError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match context.get_state() {
            ContextState::Ready => return Ok(()),
            ContextState::Failed | ContextState::Terminated => return Err(BackendError::NoDevice),
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err(BackendError::CaptureFailed(
                "连接 PulseAudio 服务器超时".into(),
            ));
        }
        pump(mainloop)?;
    }
}

/// 等待采集流就绪
fn wait_stream_ready(mainloop: &mut Mainloop, stream: &Stream) -> Result<(), BackendError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match stream.get_state() {
            StreamState::Ready => return Ok(()),
            StreamState::Failed | StreamState::Terminated => {
                return Err(BackendError::CaptureFailed("无法连接音频采集源".into()))
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err(BackendError::CaptureFailed("等待采集流就绪超时".into()));
        }
        pump(mainloop)?;
    }
}

/// 等待一次异步查询完成
fn wait_op_done(mainloop: &mut Mainloop, done: &Cell<bool>) -> Result<(), BackendError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    while !done.get() {
        if Instant::now() >= deadline {
            return Err(BackendError::CaptureFailed(
                "查询 PulseAudio 设备超时".into(),
            ));
        }
        pump(mainloop)?;
    }
    Ok(())
}

/// 解析系统声音采集源：默认 sink 对应的 monitor source 名称
fn resolve_monitor_source(
    mainloop: &mut Mainloop,
    context: &mut Context,
) -> Result<String, BackendError> {
    let sink_name = Rc::new(RefCell::new(None::<String>));
    let server_done = Rc::new(Cell::new(false));
    {
        let sink_name_cb = Rc::clone(&sink_name);
        let server_done_cb = Rc::clone(&server_done);
        let _op = context.introspect().get_server_info(move |info| {
            *sink_name_cb.borrow_mut() = info.default_sink_name.as_deref().map(str::to_owned);
            server_done_cb.set(true);
        });
        wait_op_done(mainloop, &server_done)?;
    }
    let sink_name = sink_name.borrow().clone().ok_or(BackendError::NoDevice)?;

    let monitor = Rc::new(RefCell::new(None::<String>));
    let sink_done = Rc::new(Cell::new(false));
    {
        let monitor_cb = Rc::clone(&monitor);
        let sink_done_cb = Rc::clone(&sink_done);
        let _op = context
            .introspect()
            .get_sink_info_by_name(&sink_name, move |res| {
                if let ListResult::Item(info) = res {
                    *monitor_cb.borrow_mut() =
                        info.monitor_source_name.as_deref().map(str::to_owned);
                }
                sink_done_cb.set(true);
            });
        wait_op_done(mainloop, &sink_done)?;
    }
    let monitor_name = monitor.borrow().clone().ok_or(BackendError::NoDevice)?;
    Ok(monitor_name)
}

/// 将 8 kHz 单声道 f32 小端字节转为样本向量
fn pcm_f32(data: &[u8]) -> Vec<f32> {
    data.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}
