//! 采集后端抽象：跨平台的采集会话统一由 CaptureSink 收集 8 kHz 单声道 PCM，
//! 平台模块只负责把设备数据灌入 sink，并响应 cancel

use std::fmt;
use std::sync::Arc;

use napi::bindgen_prelude::Buffer;
use tracing::{debug, info};

use crate::JsCaptureEvent;

/// 事件发射器：工作线程内把 level / done / error 事件回传主进程
pub type CaptureEmitter = Arc<dyn Fn(JsCaptureEvent) + Send + Sync>;

/// 采集来源
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CaptureSource {
    /// 系统当前播放的声音（Windows: WASAPI Loopback）
    System,
    /// 默认麦克风
    Microphone,
}

/// 采集配置
#[derive(Clone)]
pub struct CaptureConfig {
    pub source: CaptureSource,
    /// 最大采集时长（毫秒）
    pub duration_ms: u32,
}

/// 后端错误（带结构化错误码，供主进程映射 UI 文案）
#[derive(Debug)]
pub enum BackendError {
    /// 当前平台不支持采集（仅非 Windows 目标使用）
    #[allow(dead_code)]
    Unsupported,
    /// 未找到可用设备 / 设备失效
    NoDevice,
    /// 缺少权限（仅 Windows WASAPI 使用，其他平台编译时允许未使用）
    #[allow(dead_code)]
    PermissionDenied,
    /// 采集失败（具体原因）
    CaptureFailed(String),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "当前平台不支持本机采集"),
            Self::NoDevice => write!(f, "未找到可用的音频设备"),
            Self::PermissionDenied => write!(f, "缺少音频采集权限"),
            Self::CaptureFailed(msg) => write!(f, "{msg}"),
        }
    }
}

impl BackendError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::NoDevice => "no-device",
            Self::PermissionDenied => "permission-denied",
            Self::CaptureFailed(_) => "capture-failed",
        }
    }
}

/// 目标采样率：AFP 需要的 8 kHz 单声道
pub const TARGET_SAMPLE_RATE: u32 = 8000;

/// 音量事件推送间隔（毫秒），对应计划中的低频 UI 更新
const LEVEL_INTERVAL_MS: u32 = 100;

/// 平台采集后端
pub trait CaptureBackend: Send + Sync {
    /// 设备采样率（用于降采样与音量间隔计算）
    fn sample_rate(&self) -> u32;
    /// 阻塞运行采集循环，直到采集完成或被取消
    fn run(&self, sink: &mut CaptureSink) -> Result<(), BackendError>;
    /// 原子取消标记 + 唤醒等待线程
    fn cancel(&self);
    /// 是否已被取消
    fn is_cancelled(&self) -> bool;
}

/// 采集数据收集器：PCM 只在本模块内累计，不跨进程传输
pub struct CaptureSink {
    emitter: CaptureEmitter,
    /// 采集到的单声道样本（原生采样率）
    mono: Vec<f32>,
    /// 原生采样率
    sample_rate: u32,
    /// 最大采集时长（毫秒）
    duration_ms: u32,
    /// 目标样本数（= 采样率 × 时长秒）
    target_samples: usize,
    /// 当前音量区间内的能量累计（用于 RMS）
    level_energy: f64,
    /// 当前音量区间内的样本数
    level_count: usize,
    /// 距离上次音量推送的样本数
    level_pending: usize,
    /// 音量推送间隔样本数
    level_interval: usize,
}

impl CaptureSink {
    /// 创建 sink，sample_rate 为设备原始采样率，输出统一为 8 kHz 单声道
    pub fn new(emitter: CaptureEmitter, sample_rate: u32, duration_ms: u32) -> Self {
        let mut sink = Self {
            emitter,
            mono: Vec::new(),
            sample_rate,
            duration_ms,
            target_samples: 0,
            level_energy: 0.0,
            level_count: 0,
            level_pending: 0,
            level_interval: 1,
        };
        sink.set_sample_rate(sample_rate);
        sink.mono.reserve(sink.target_samples);
        sink
    }

    /// 设备打开后设置真实采样率，重新计算目标样本数与音量间隔
    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        self.sample_rate = sample_rate;
        self.target_samples = (sample_rate as u64 * self.duration_ms as u64 / 1000) as usize;
        self.level_interval = (sample_rate as u64 * LEVEL_INTERVAL_MS as u64 / 1000) as usize;
    }

    /// 累计一段单声道样本，并在达到推送间隔时发送音量事件。
    /// 逐样本检查：PulseAudio 可能一次送来覆盖多个间隔的大数据块，
    /// 只按块触发一次会丢失频谱事件，因此按间隔多次推送
    pub fn push_mono(&mut self, samples: &[f32]) {
        for &s in samples {
            self.level_energy += (s as f64) * (s as f64);
            self.level_count += 1;
            self.level_pending += 1;
            if self.level_pending >= self.level_interval {
                self.emit_level();
            }
        }
        self.mono.extend_from_slice(samples);
    }

    /// 静音帧：保持计数前进，音量归零
    pub fn push_silence(&mut self, frames: usize) {
        for _ in 0..frames {
            self.level_pending += 1;
            if self.level_pending >= self.level_interval {
                self.emit_level();
            }
        }
        self.mono.extend(std::iter::repeat_n(0.0f32, frames));
    }

    /// 是否已采集够目标时长
    pub fn ready(&self) -> bool {
        self.mono.len() >= self.target_samples
    }

    /// 墙钟时长到达但设备没有补足 packet 时，用静音补齐目标长度
    pub fn pad_to_target(&mut self) {
        let remaining = self.target_samples.saturating_sub(self.mono.len());
        if remaining > 0 {
            self.push_silence(remaining);
        }
    }

    /// 计算并推送当前音量（RMS）
    fn emit_level(&mut self) {
        let level = if self.level_count == 0 {
            0.0
        } else {
            (self.level_energy / self.level_count as f64).sqrt()
        };
        self.level_energy = 0.0;
        self.level_count = 0;
        self.level_pending = 0;
        (self.emitter)(JsCaptureEvent {
            event_type: "level".into(),
            data: None,
            level: Some(level),
            error: None,
            error_code: None,
        });
    }

    /// 推送完成事件，cancelled 时不带数据（主进程按取消处理）
    pub fn emit_done(&mut self, cancelled: bool) {
        debug!(samples = self.mono.len(), "采集完成，开始降采样");
        let data = if cancelled {
            None
        } else {
            let mono_8k = downsample_mono(&self.mono, self.sample_rate, TARGET_SAMPLE_RATE);
            info!(samples = mono_8k.len(), "采集结束，输出 8kHz PCM");
            let mut bytes = Vec::with_capacity(mono_8k.len() * 4);
            for v in mono_8k {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            Some(Buffer::from(bytes))
        };
        (self.emitter)(JsCaptureEvent {
            event_type: "done".into(),
            data,
            level: None,
            error: None,
            error_code: None,
        });
        self.mono.clear();
    }

    /// 推送错误事件
    pub fn emit_error(&self, error: BackendError) {
        tracing::error!(%error, code = error.code(), "采集失败");
        (self.emitter)(JsCaptureEvent {
            event_type: "error".into(),
            data: None,
            level: None,
            error: Some(error.to_string()),
            error_code: Some(error.code().into()),
        });
    }
}

/// 单声道降采样：按输入/输出比例做窗口平均（低通 + 抽取），整数与分数比例均可用
/// 首版实现，命中率验证后再考虑更高质量滤波器
fn downsample_mono(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if input.is_empty() || in_rate <= out_rate {
        return input.to_vec();
    }
    let ratio = in_rate as f64 / out_rate as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = (i as f64 * ratio) as usize;
        let end = (((i + 1) as f64) * ratio).ceil() as usize;
        let end = end.min(input.len());
        let mut sum = 0.0f32;
        let mut count = 0usize;
        for &v in &input[start..end] {
            sum += v;
            count += 1;
        }
        out.push(sum / count.max(1) as f32);
    }
    out
}
