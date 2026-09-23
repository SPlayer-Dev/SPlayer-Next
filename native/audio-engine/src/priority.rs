#[cfg(target_os = "windows")]
mod imp {
    use tracing::{debug, warn};
    use windows::core::w;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Threading::{
        AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority,
        GetCurrentThread, SetThreadPriority, AVRT_PRIORITY_HIGH, THREAD_PRIORITY_HIGHEST,
    };

    /// MMCSS 注册必须由同一线程释放；HANDLE 的非 Send 属性限制守卫跨线程移动。
    pub struct RenderThreadPriority(HANDLE);

    impl RenderThreadPriority {
        pub fn new() -> Option<Self> {
            let mut task_index = 0;
            let handle =
                match unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) } {
                    Ok(handle) => handle,
                    Err(error) => {
                        warn!(%error, "独占渲染线程注册 MMCSS 失败，使用普通音频线程优先级");
                        boost_current_audio_thread("wasapi-exclusive");
                        return None;
                    }
                };
            if let Err(error) = unsafe { AvSetMmThreadPriority(handle, AVRT_PRIORITY_HIGH) } {
                warn!(%error, "设置 MMCSS 相对优先级失败，保留任务默认优先级");
            }
            debug!(task_index, "独占渲染线程已注册 MMCSS Pro Audio");
            Some(Self(handle))
        }
    }

    impl Drop for RenderThreadPriority {
        fn drop(&mut self) {
            if let Err(error) = unsafe { AvRevertMmThreadCharacteristics(self.0) } {
                warn!(%error, "释放独占渲染线程 MMCSS 注册失败");
            }
        }
    }

    pub fn boost_current_audio_thread(name: &str) {
        unsafe {
            if let Err(err) = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) {
                warn!(thread = name, error = %err, "设置音频线程优先级失败");
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn boost_current_audio_thread(_name: &str) {}
}

pub use imp::boost_current_audio_thread;
#[cfg(target_os = "windows")]
pub use imp::RenderThreadPriority;
