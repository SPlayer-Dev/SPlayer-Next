//! audio-capture：系统声音 / 麦克风采集原生模块
//! 采集在工作线程中进行，PCM 与音量事件经 ThreadsafeFunction 回传主进程

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;

use napi::bindgen_prelude::{Buffer, Function};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Result;
use napi_derive::napi;

mod backend;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

use backend::{CaptureBackend, CaptureConfig, CaptureSink, CaptureSource};

#[napi(object)]
pub struct JsCaptureConfig {
    /// 采集来源："system"（系统声音）| "microphone"
    pub source: String,
    /// 最大采集时长（毫秒）
    pub duration_ms: u32,
}

#[napi(object)]
pub struct JsCaptureEvent {
    /// "level" | "done" | "error"
    pub event_type: String,
    /// 8 kHz 单声道 f32 LE 原始字节（仅 done 事件，cancelled 时为 None）
    pub data: Option<Buffer>,
    /// 当前音量 RMS（level 事件）
    pub level: Option<f64>,
    /// 错误消息（error 事件）
    pub error: Option<String>,
    /// 错误码："unsupported" | "no-device" | "permission-denied" | "capture-failed"
    pub error_code: Option<String>,
}

struct AudioCaptureSessionInner {
    cancelled: Arc<AtomicBool>,
    backend: Arc<Mutex<Option<Arc<dyn CaptureBackend>>>>,
}

/// 一次采集会话
#[napi]
pub struct AudioCaptureSession {
    inner: Arc<AudioCaptureSessionInner>,
}

#[napi]
impl AudioCaptureSession {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AudioCaptureSessionInner {
                cancelled: Arc::new(AtomicBool::new(false)),
                backend: Arc::new(Mutex::new(None)),
            }),
        }
    }

    /// 当前平台是否支持本机采集
    #[napi]
    pub fn is_supported(&self) -> bool {
        platform_supported()
    }

    /// 开始采集
    #[napi(ts_args_type = "config: JsCaptureConfig, callback: (event: JsCaptureEvent) => void")]
    pub fn start(
        &self,
        config: JsCaptureConfig,
        callback: Function<JsCaptureEvent, ()>,
    ) -> Result<()> {
        let source = match config.source.as_str() {
            "system" => CaptureSource::System,
            "microphone" => CaptureSource::Microphone,
            other => return Err(napi::Error::from_reason(format!("未知采集来源: {other}"))),
        };
        if !platform_supported() {
            return Err(napi::Error::from_reason("当前平台不支持本机采集"));
        }
        let cfg = CaptureConfig {
            source,
            duration_ms: config.duration_ms,
        };
        let tsfn = callback.build_threadsafe_function().build()?;
        let emitter: backend::CaptureEmitter = Arc::new(move |event: JsCaptureEvent| {
            tsfn.call(event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        let cancelled = Arc::clone(&self.inner.cancelled);
        let backend = Arc::clone(&self.inner.backend);
        thread::spawn(move || {
            let mut sink = CaptureSink::new(emitter, 16000, cfg.duration_ms);
            let _com = match init_com() {
                Ok(guard) => guard,
                Err(e) => {
                    sink.emit_error(e);
                    return;
                }
            };
            match open_backend(&cfg, Arc::clone(&cancelled)) {
                Ok(b) => {
                    if cancelled.load(Ordering::Acquire) {
                        b.cancel();
                    }
                    *backend.lock().unwrap() = Some(Arc::clone(&b));
                    sink.set_sample_rate(b.sample_rate());
                    match b.run(&mut sink) {
                        Ok(()) => sink.emit_done(b.is_cancelled()),
                        Err(e) => sink.emit_error(e),
                    }
                }
                Err(e) => sink.emit_error(e),
            }
        });
        Ok(())
    }

    /// 取消采集（可安全重复调用）
    #[napi]
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::Release);
        if let Some(b) = self.inner.backend.lock().unwrap().as_ref() {
            b.cancel();
        }
    }
}

fn platform_supported() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows::platform_supported()
    }
    #[cfg(target_os = "linux")]
    {
        linux::platform_supported()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        unsupported::platform_supported()
    }
}

/// 在当前线程初始化平台采集环境（Windows: COM MTA），守卫随作用域结束自动清理
fn init_com() -> std::result::Result<impl Drop, backend::BackendError> {
    #[cfg(target_os = "windows")]
    {
        windows::init_com()
    }
    #[cfg(target_os = "linux")]
    {
        linux::init_com()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        unsupported::init_com()
    }
}

fn open_backend(
    config: &CaptureConfig,
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Arc<dyn CaptureBackend>, backend::BackendError> {
    #[cfg(target_os = "windows")]
    {
        windows::open_backend(config, cancelled)
    }
    #[cfg(target_os = "linux")]
    {
        linux::open_backend(config, cancelled)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        unsupported::open_backend(config, cancelled)
    }
}
