//! XDG Desktop Portal 全局快捷键（Linux Wayland）NAPI 层
//!
//! 通过 NAPI-RS 暴露给 Node.js，用于在 Wayland 下替代 Electron 的 globalShortcut。
//! 非 Linux 平台提供返回失败的 stub，保证工作区编译与测试通过。

mod logger;
mod model;
#[cfg(target_os = "linux")]
mod shortcuts;

use napi_derive::napi;
use tracing::info;

#[cfg(target_os = "linux")]
use napi::threadsafe_function::ThreadsafeFunction;

use model::{PortalCapability, PortalResult, PortalShortcut};

#[cfg(not(target_os = "linux"))]
fn unsupported_error() -> String {
    "当前平台不支持 XDG Desktop Portal".to_string()
}

/// 初始化原生日志系统（主进程启动时调用一次）
#[napi]
pub fn init_logger(log_dir: String, is_dev: bool) {
    logger::init_logger(&log_dir, is_dev);
    info!(log_dir, is_dev, "linux-portal 日志系统已初始化");
}

/// 检测 portal 后端是否支持 GlobalShortcuts 接口
#[napi]
pub async fn detect() -> PortalCapability {
    #[cfg(target_os = "linux")]
    {
        shortcuts::detect().await
    }
    #[cfg(not(target_os = "linux"))]
    {
        PortalCapability {
            supported: false,
            version: 0,
            configure_supported: false,
            error: Some(unsupported_error()),
        }
    }
}

/// 通过 portal 绑定全部全局快捷键（重绑会先释放旧会话）
#[napi]
pub async fn bind_shortcuts(shortcuts: Vec<PortalShortcut>) -> PortalResult {
    #[cfg(target_os = "linux")]
    {
        match shortcuts::bind_shortcuts(shortcuts).await {
            Ok(()) => PortalResult {
                ok: true,
                error: None,
            },
            Err(e) => {
                tracing::error!(error = %e, "portal 绑定全局快捷键失败");
                PortalResult {
                    ok: false,
                    error: Some(e),
                }
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = shortcuts;
        PortalResult {
            ok: false,
            error: Some(unsupported_error()),
        }
    }
}

/// 释放当前 portal 会话（解绑全部快捷键）
#[napi]
pub async fn unbind_shortcuts() -> PortalResult {
    #[cfg(target_os = "linux")]
    {
        match shortcuts::unbind_shortcuts().await {
            Ok(()) => PortalResult {
                ok: true,
                error: None,
            },
            Err(e) => PortalResult {
                ok: false,
                error: Some(e),
            },
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        PortalResult {
            ok: true,
            error: None,
        }
    }
}

/// 打开系统侧快捷键配置界面（需 portal version >= 2）
#[napi]
pub async fn configure_shortcuts() -> PortalResult {
    #[cfg(target_os = "linux")]
    {
        match shortcuts::configure_shortcuts().await {
            Ok(()) => PortalResult {
                ok: true,
                error: None,
            },
            Err(e) => PortalResult {
                ok: false,
                error: Some(e),
            },
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        PortalResult {
            ok: false,
            error: Some(unsupported_error()),
        }
    }
}

/// 注册激活回调，portal 触发快捷键时回调对应动作 id
#[napi]
#[cfg(target_os = "linux")]
pub fn on_activated(callback: ThreadsafeFunction<String>) {
    shortcuts::on_activated(callback);
}

/// 关闭并清理资源（应用退出时调用，fire-and-forget 即可）
#[napi]
pub async fn shutdown() {
    #[cfg(target_os = "linux")]
    {
        shortcuts::shutdown().await;
    }
}
