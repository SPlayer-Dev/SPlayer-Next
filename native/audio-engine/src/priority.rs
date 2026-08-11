#[cfg(target_os = "windows")]
mod imp {
    use tracing::warn;
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
    };

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
