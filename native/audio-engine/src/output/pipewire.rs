pub(super) fn format_pipewire_props(sample_rate: u32) -> String {
    // 以时间比例建议周期，避免同样的帧数在高采样率下变成过短的截止时间。
    let mut props = serde_json::json!({
        "application.id": "top.imsyy.splayer_next",
        "application.name": "SPlayer-Next",
        "application.icon-name": "top.imsyy.splayer_next",
        "media.name": "Playback",
        "node.latency": "1024/48000",
    });
    if sample_rate > 0 {
        props["node.rate"] = format!("1/{sample_rate}").into();
    }
    props.to_string()
}

#[cfg(target_os = "linux")]
pub(super) mod pipewire_props {
    use std::{
        ffi::OsString,
        sync::{Mutex, MutexGuard},
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    pub(crate) struct Guard {
        original: Option<OsString>,
        _lock: MutexGuard<'static, ()>,
    }

    impl Guard {
        pub(crate) fn set_stream_props(sample_rate: u32) -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
            let original = std::env::var_os("PIPEWIRE_PROPS");
            // 用户可能使用 SPA JSON（而非标准 JSON），原样保留其显式配置。
            if original.is_some() {
                return Self {
                    original,
                    _lock: lock,
                };
            }

            unsafe {
                std::env::set_var("PIPEWIRE_PROPS", super::format_pipewire_props(sample_rate));
            }

            Self {
                original,
                _lock: lock,
            }
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                match self.original.take() {
                    Some(value) => std::env::set_var("PIPEWIRE_PROPS", value),
                    None => std::env::remove_var("PIPEWIRE_PROPS"),
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/pipewire.rs"]
mod tests;
