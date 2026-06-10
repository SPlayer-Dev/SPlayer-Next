//! 监听 HKCU 子键变化的轻量 watcher：基于 RegNotifyChangeKeyValue + 停止事件。
//!
//! 主要用于监听任务栏深浅色主题切换（SystemUsesLightTheme / AppsUseLightTheme）

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use napi::{
    Status,
    bindgen_prelude::Function,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;
use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
        System::{
            Registry::{
                HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RegCloseKey,
                RegNotifyChangeKeyValue, RegOpenKeyExW,
            },
            Threading::{CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects},
        },
    },
    core::HSTRING,
};

type VoidTsfn = ThreadsafeFunction<(), UnknownReturnValue, (), Status, false>;

struct EventHandle(HANDLE);

impl Drop for EventHandle {
    fn drop(&mut self) {
        // SAFETY: handle 由 CreateEventW 创建，仅在 Drop 时关闭
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

// SAFETY: HANDLE 是 Win32 不透明指针，跨线程读 + 单线程关闭安全
unsafe impl Send for EventHandle {}
unsafe impl Sync for EventHandle {}

#[napi]
pub struct RegistryWatcher {
    stop_event: Arc<EventHandle>,
    is_running: Arc<AtomicBool>,
}

#[napi]
impl RegistryWatcher {
    /// 监听 HKCU 下指定子键变化；`sub_key` 用反斜杠分隔，如
    /// `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced`
    #[napi(constructor, ts_args_type = "subKey: string, callback: () => void")]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(sub_key: String, callback: Function<(), UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<()>()
            .build_callback(|_ctx| Ok(()))?;

        // SAFETY: 手动重置事件，由 stop() 触发；失败时通过 ? 传播
        let raw_event = unsafe { CreateEventW(None, true, false, None) }
            .map_err(|e| napi::Error::from_reason(format!("创建停止事件失败: {e}")))?;

        let stop_event = Arc::new(EventHandle(raw_event));
        let is_running = Arc::new(AtomicBool::new(true));
        let thread_event = stop_event.clone();

        thread::spawn(move || {
            registry_watch_loop(&thread_event, &tsfn, &sub_key);
        });

        Ok(Self {
            stop_event,
            is_running,
        })
    }

    #[napi]
    pub fn stop(&self) {
        if !self.is_running.load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: stop_event 在 self 生命周期内一直有效（Arc 持有）
        unsafe {
            let _ = SetEvent(self.stop_event.0);
        }
        self.is_running.store(false, Ordering::SeqCst);
    }
}

/// JS 侧不调 stop 直接 GC 时兜底，否则监听线程永久阻塞在 WaitForMultipleObjects 并钉住 TSFN
impl Drop for RegistryWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

fn registry_watch_loop(stop_event_wrapper: &Arc<EventHandle>, tsfn: &VoidTsfn, sub_key: &str) {
    let stop_event = stop_event_wrapper.0;
    let mut h_key = HKEY::default();
    let sub_key_wide = HSTRING::from(sub_key);

    // SAFETY: 出参 h_key 由 Win32 写入，使用前判定 is_err
    if unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &sub_key_wide,
            Some(0),
            KEY_NOTIFY,
            &raw mut h_key,
        )
    }
    .is_err()
    {
        return;
    }

    // SAFETY: 创建一个自动重置的通知事件，失败时关闭已打开的注册表 handle
    let reg_event = match unsafe { CreateEventW(None, false, false, None) } {
        Ok(evt) => evt,
        Err(_) => {
            unsafe {
                let _ = RegCloseKey(h_key);
            }
            return;
        }
    };

    loop {
        // SAFETY: h_key / reg_event 在本函数生命周期内有效
        let notify_res = unsafe {
            RegNotifyChangeKeyValue(
                h_key,
                true,
                REG_NOTIFY_CHANGE_LAST_SET,
                Some(reg_event),
                true,
            )
        };
        if notify_res.is_err() {
            break;
        }

        let handles = [stop_event, reg_event];
        // SAFETY: handles 栈上有效，stop_event / reg_event 由调用方/本函数持有
        let wait_result = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
        let index = wait_result.0.wrapping_sub(WAIT_OBJECT_0.0);
        match index {
            0 => break,
            1 => {
                tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
            }
            _ => break,
        }
    }

    // SAFETY: 释放在本函数中创建/打开的两个 handle
    unsafe {
        let _ = CloseHandle(reg_event);
        let _ = RegCloseKey(h_key);
    }
}
