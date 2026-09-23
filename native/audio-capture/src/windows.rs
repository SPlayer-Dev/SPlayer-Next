//! Windows WASAPI 采集：系统声音用 Loopback，麦克风用默认 Capture 设备
//! 优先请求 WASAPI 自动转换为 16 kHz 单声道 32-bit Float（AUTOCONVERTPCM），
//! 失败时回退到混音格式并在本模块内手动混音/降采样

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use windows::core::{GUID, HRESULT, PCWSTR};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_EVENT, WAIT_OBJECT_0, WAIT_TIMEOUT},
    Media::Audio::{
        eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        WAVEFORMATEXTENSIBLE_0,
    },
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    },
    System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects},
};

use super::backend::{BackendError, CaptureBackend, CaptureConfig, CaptureSink, CaptureSource};

/// 请求 WASAPI 转换为 16 kHz 单声道 32-bit Float
const REQUEST_SAMPLE_RATE: u32 = 16000;

const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const WAVE_FORMAT_PCM: u16 = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
/// SPEAKER_FRONT_CENTER
const SPEAKER_FRONT_CENTER: u32 = 0x4;
/// E_ACCESSDENIED
const E_ACCESSDENIED: HRESULT = HRESULT::from_win32(5);

const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

/// 样本类型
#[derive(Clone, Copy)]
enum SampleKind {
    F32,
    I16,
}

/// 采集流格式
#[derive(Clone, Copy)]
struct CaptureFormat {
    channels: usize,
    sample_rate: u32,
    kind: SampleKind,
}

/// COM 公寓守卫：初始化的线程与析构线程必须一致
pub struct ComApartmentGuard;

impl ComApartmentGuard {
    unsafe fn init() -> Result<Self, BackendError> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| BackendError::CaptureFailed(format!("初始化 COM 失败: {e}")))?;
        Ok(Self)
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

/// 在当前线程初始化 COM（MTA），守卫随作用域结束自动反初始化
pub fn init_com() -> Result<ComApartmentGuard, BackendError> {
    unsafe { ComApartmentGuard::init() }
}

/// WASAPI 采集后端
pub struct WindowsBackend {
    audio_client: IAudioClient,
    capture_client: IAudioCaptureClient,
    audio_event: HANDLE,
    cancel_event: HANDLE,
    cancelled: Arc<AtomicBool>,
    format: CaptureFormat,
    duration_ms: u32,
}

impl Drop for WindowsBackend {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.audio_event);
            let _ = CloseHandle(self.cancel_event);
        }
    }
}

// 仅在本模块内部跨工作线程共享，句柄与 COM 接口均按文档线程安全使用
unsafe impl Send for WindowsBackend {}
unsafe impl Sync for WindowsBackend {}

impl CaptureBackend for WindowsBackend {
    fn sample_rate(&self) -> u32 {
        self.format.sample_rate
    }

    fn run(&self, sink: &mut CaptureSink) -> Result<(), BackendError> {
        unsafe { self.audio_client.Start() }
            .map_err(|e| BackendError::CaptureFailed(format!("启动采集失败: {e}")))?;
        let result = self.capture_loop(sink);
        unsafe {
            let _ = self.audio_client.Stop();
        }
        result
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        let _ = unsafe { SetEvent(self.cancel_event) };
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

impl WindowsBackend {
    fn capture_loop(&self, sink: &mut CaptureSink) -> Result<(), BackendError> {
        let deadline = Instant::now() + Duration::from_millis(self.duration_ms as u64);
        loop {
            let wait = unsafe {
                WaitForMultipleObjects(&[self.audio_event, self.cancel_event], false, 200)
            };
            if wait == WAIT_OBJECT_0 {
                self.read_packets(sink)?;
                if self.cancelled.load(Ordering::Acquire) || sink.ready() {
                    break;
                }
            } else if wait == WAIT_EVENT(WAIT_OBJECT_0.0 + 1) {
                break;
            } else if wait != WAIT_TIMEOUT {
                return Err(BackendError::CaptureFailed("等待音频事件失败".into()));
            }
            if Instant::now() >= deadline {
                sink.pad_to_target();
                break;
            }
        }
        Ok(())
    }

    /// 排空当前所有 packet，转换为单声道后灌入 sink
    fn read_packets(&self, sink: &mut CaptureSink) -> Result<(), BackendError> {
        loop {
            let packet = unsafe { self.capture_client.GetNextPacketSize() }
                .map_err(|e| BackendError::CaptureFailed(e.to_string()))?;
            if packet == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            unsafe {
                self.capture_client
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
            }
            .map_err(|e| BackendError::CaptureFailed(e.to_string()))?;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 {
                sink.push_silence(frames as usize);
            } else {
                let mono = self.convert(data, frames);
                sink.push_mono(&mono);
            }
            unsafe { self.capture_client.ReleaseBuffer(frames) }
                .map_err(|e| BackendError::CaptureFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// 将 packet 原始字节转为单声道 f32（按格式解释样本）
    fn convert(&self, data: *mut u8, frames: u32) -> Vec<f32> {
        let total = frames as usize * self.format.channels;
        let mut out = Vec::with_capacity(frames as usize);
        match self.format.kind {
            SampleKind::F32 => {
                let slice = unsafe { std::slice::from_raw_parts(data as *const f32, total) };
                for frame in slice.chunks(self.format.channels) {
                    let sum: f32 = frame.iter().sum();
                    out.push(sum / self.format.channels as f32);
                }
            }
            SampleKind::I16 => {
                let slice = unsafe { std::slice::from_raw_parts(data as *const i16, total) };
                for frame in slice.chunks(self.format.channels) {
                    let sum: i32 = frame.iter().map(|&v| v as i32).sum();
                    out.push((sum as f32 / self.format.channels as f32) / 32768.0);
                }
            }
        }
        out
    }
}

/// 目标格式：16 kHz 单声道 32-bit Float（AUTOCONVERTPCM）
fn desired_format() -> WAVEFORMATEXTENSIBLE {
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: 1,
            nSamplesPerSec: REQUEST_SAMPLE_RATE,
            nAvgBytesPerSec: REQUEST_SAMPLE_RATE * 4,
            nBlockAlign: 4,
            wBitsPerSample: 32,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: 32,
        },
        dwChannelMask: SPEAKER_FRONT_CENTER,
        SubFormat: KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
    }
}

/// 解析混音格式（WAVEFORMATEX / WAVEFORMATEXTENSIBLE）
fn parse_mix_format(raw: *mut WAVEFORMATEX) -> Result<CaptureFormat, BackendError> {
    if raw.is_null() {
        return Err(BackendError::CaptureFailed(
            "GetMixFormat 返回空格式".into(),
        ));
    }
    let wfx = unsafe { &*raw };
    let channels = wfx.nChannels as usize;
    let sample_rate = wfx.nSamplesPerSec;
    if wfx.wFormatTag == WAVE_FORMAT_EXTENSIBLE {
        let ext = unsafe { &*(raw as *const WAVEFORMATEXTENSIBLE) };
        // WAVEFORMATEXTENSIBLE 为 packed 结构，SubFormat 需要非对齐读取
        let sub_format = unsafe { std::ptr::addr_of!(ext.SubFormat).read_unaligned() };
        let kind = if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && wfx.wBitsPerSample == 32 {
            SampleKind::F32
        } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM && wfx.wBitsPerSample == 16 {
            SampleKind::I16
        } else {
            return Err(BackendError::CaptureFailed("不支持的混音格式".into()));
        };
        Ok(CaptureFormat {
            channels,
            sample_rate,
            kind,
        })
    } else if wfx.wFormatTag == WAVE_FORMAT_PCM && wfx.wBitsPerSample == 16 {
        Ok(CaptureFormat {
            channels,
            sample_rate,
            kind: SampleKind::I16,
        })
    } else if wfx.wFormatTag == WAVE_FORMAT_IEEE_FLOAT && wfx.wBitsPerSample == 32 {
        Ok(CaptureFormat {
            channels,
            sample_rate,
            kind: SampleKind::F32,
        })
    } else {
        Err(BackendError::CaptureFailed("不支持的混音格式".into()))
    }
}

fn map_init_error(e: windows::core::Error) -> BackendError {
    if e.code() == E_ACCESSDENIED {
        BackendError::PermissionDenied
    } else {
        BackendError::CaptureFailed(e.to_string())
    }
}

/// 当前平台是否支持采集
pub fn platform_supported() -> bool {
    true
}

/// 在调用线程上打开采集后端（需先初始化 COM）
pub fn open_backend(
    config: &CaptureConfig,
    cancelled: Arc<AtomicBool>,
) -> Result<Arc<dyn CaptureBackend>, BackendError> {
    let flow = if config.source == CaptureSource::System {
        eRender
    } else {
        eCapture
    };
    let loopback = config.source == CaptureSource::System;

    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| BackendError::CaptureFailed(format!("创建设备枚举器失败: {e}")))?;
    let device: IMMDevice = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }
        .map_err(|_| BackendError::NoDevice)?;

    // 优先：AUTOCONVERTPCM 到 16kHz 单声道 f32
    let base_flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    let loopback_flag = if loopback {
        AUDCLNT_STREAMFLAGS_LOOPBACK
    } else {
        0
    };

    let wfx = desired_format();
    let client: IAudioClient =
        unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(map_init_error)?;
    let init_result = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            base_flags | loopback_flag,
            0,
            0,
            &wfx as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX,
            None,
        )
    };

    let (format, client): (CaptureFormat, IAudioClient) = match init_result {
        Ok(()) => (
            CaptureFormat {
                channels: 1,
                sample_rate: REQUEST_SAMPLE_RATE,
                kind: SampleKind::F32,
            },
            client,
        ),
        Err(_) => {
            // 回退：混音格式 + 手动混音/降采样
            let mix = unsafe { client.GetMixFormat() }
                .map_err(|e| BackendError::CaptureFailed(format!("获取混音格式失败: {e}")))?;
            let fmt = parse_mix_format(mix)?;
            let fresh: IAudioClient =
                unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(map_init_error)?;
            let init = unsafe {
                fresh.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK | loopback_flag,
                    0,
                    0,
                    mix,
                    None,
                )
            };
            unsafe {
                CoTaskMemFree(Some(mix as *const _));
            }
            init.map_err(map_init_error)?;
            (fmt, fresh)
        }
    };

    let capture_client: IAudioCaptureClient = unsafe { client.GetService() }
        .map_err(|e| BackendError::CaptureFailed(format!("获取采集接口失败: {e}")))?;
    let audio_event = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
        .map_err(|e| BackendError::CaptureFailed(format!("创建事件句柄失败: {e}")))?;
    let cancel_event = match unsafe { CreateEventW(None, false, false, PCWSTR::null()) } {
        Ok(evt) => evt,
        Err(e) => {
            unsafe {
                let _ = CloseHandle(audio_event);
            }
            return Err(BackendError::CaptureFailed(format!(
                "创建事件句柄失败: {e}"
            )));
        }
    };
    if let Err(e) = unsafe { client.SetEventHandle(audio_event) } {
        unsafe {
            let _ = CloseHandle(audio_event);
            let _ = CloseHandle(cancel_event);
        }
        return Err(BackendError::CaptureFailed(format!(
            "设置事件句柄失败: {e}"
        )));
    }

    Ok(Arc::new(WindowsBackend {
        audio_client: client,
        capture_client,
        audio_event,
        cancel_event,
        cancelled,
        format,
        duration_ms: config.duration_ms.clamp(3_000, 12_000),
    }))
}
