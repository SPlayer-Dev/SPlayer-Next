//! XDG Desktop Portal GlobalShortcuts 实现（仅 Linux）
//!
//! 通过 ashpd 与 `org.freedesktop.portal.Desktop` 通信，在 Wayland 下注册全局快捷键。
//! 每个会话只能 BindShortcuts 一次，因此重绑（语言变更 / 开关切换）时总是新建会话。

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex, OnceLock,
};

use ashpd::desktop::ResponseError;
use ashpd::desktop::{
    global_shortcuts::{GlobalShortcuts, NewShortcut},
    CreateSessionOptions, Session,
};
use ashpd::Error as AshpdError;
use futures_util::StreamExt;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::model::{PortalCapability, PortalShortcut};

/// 激活回调（线程安全函数，回调参数为触发动作的 id）
type ActivatedCallback = ThreadsafeFunction<String>;

struct State {
    proxy: Mutex<Option<Arc<GlobalShortcuts>>>,
    session: Mutex<Option<Session<GlobalShortcuts>>>,
    /// 会话变更操作锁：bind/unbind/shutdown/configure 全程串行化
    /// 防止并发调用各自创建会话、后写入者覆盖前一个（残留重复注册与重复 Activated 回调）
    operation: Mutex<()>,
    version: Mutex<u32>,
    activated_cb: StdMutex<Option<ActivatedCallback>>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            proxy: Mutex::new(None),
            session: Mutex::new(None),
            operation: Mutex::new(()),
            version: Mutex::new(0),
            activated_cb: StdMutex::new(None),
        }
    }
}

static STATE: OnceLock<State> = OnceLock::new();

fn state() -> &'static State {
    STATE.get_or_init(State::default)
}

/// 检测 portal 后端是否支持 GlobalShortcuts 接口
///
/// 仅连接并尝试创建一次会话（随后立即关闭）做探测，不产生任何 UI。
pub async fn detect() -> PortalCapability {
    let proxy = match GlobalShortcuts::new().await {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "连接 XDG Desktop Portal 失败");
            return PortalCapability {
                supported: false,
                version: 0,
                configure_supported: false,
                error: Some(e.to_string()),
            };
        }
    };
    let version = proxy.version();

    // 仅探测接口可用性。探测会话必须立即关闭：KDE 后端 CreateSession 会 loadActions
    // 并把会话订阅到 globalShortcutPressed，残留会话会导致每次触发都重复上报 Activated
    match proxy.create_session(CreateSessionOptions::default()).await {
        Ok(probe) => {
            if let Err(e) = probe.close().await {
                warn!(error = %e, "关闭 GlobalShortcuts 探测会话失败");
            }
        }
        Err(e) => {
            error!(error = %e, "GlobalShortcuts 接口不可用");
            return PortalCapability {
                supported: false,
                version,
                configure_supported: false,
                error: Some(e.to_string()),
            };
        }
    }

    let proxy = Arc::new(proxy);
    *state().proxy.lock().await = Some(Arc::clone(&proxy));
    *state().version.lock().await = version;
    spawn_activated_listener(proxy);

    info!(version, "XDG Desktop Portal GlobalShortcuts 检测通过");
    PortalCapability {
        supported: true,
        version,
        configure_supported: version >= 2,
        error: None,
    }
}

/// 通过 portal 绑定全部全局快捷键
///
/// BindShortcuts 每个会话只能调用一次，因此重绑前会先关闭旧会话。
///
/// 用户取消系统授权框（ResponseError::Cancelled）时不视为失败：快捷键仍然注册成功，
/// 只是未分配 preferred_trigger（用户后续可在系统设置里手动指定），保留会话即算绑定完成。
pub async fn bind_shortcuts(shortcuts: Vec<PortalShortcut>) -> Result<(), String> {
    let st = state();
    let proxy = {
        let guard = st.proxy.lock().await;
        Arc::clone(
            guard
                .as_ref()
                .ok_or_else(|| "portal 尚未初始化".to_string())?,
        )
    };

    // 操作锁：关闭旧会话、创建、绑定、替换 session 全程串行，避免并发调用互相覆盖
    let _operation = st.operation.lock().await;

    if let Some(old) = st.session.lock().await.take() {
        let _ = old.close().await;
    }

    let new_shortcuts: Vec<NewShortcut> = shortcuts
        .into_iter()
        .map(|s| {
            let mut shortcut = NewShortcut::new(s.id, s.description);
            if let Some(trigger) = s.preferred_trigger {
                shortcut = shortcut.preferred_trigger(trigger.as_str());
            }
            shortcut
        })
        .collect();

    let session = proxy
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|e| format!("创建 GlobalShortcuts 会话失败: {e}"))?;

    let request = match proxy
        .bind_shortcuts(&session, &new_shortcuts, None, Default::default())
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = session.close().await;
            return Err(format!("绑定全局快捷键失败: {e}"));
        }
    };

    let bound = match request.response() {
        Ok(resp) => resp.shortcuts().to_vec(),
        Err(AshpdError::Response(ResponseError::Cancelled)) => {
            // 用户取消授权框：快捷键已注册，仅未分配 preferred_trigger，保留会话
            info!("用户取消全局快捷键授权，快捷键仍注册成功（未分配默认触发器）");
            Vec::new()
        }
        Err(e) => {
            let _ = session.close().await;
            return Err(format!("绑定全局快捷键失败: {e}"));
        }
    };

    *st.session.lock().await = Some(session);
    info!(count = bound.len(), "全局快捷键已通过 portal 绑定");
    Ok(())
}

/// 释放当前 portal 会话（解绑全部快捷键）
pub async fn unbind_shortcuts() -> Result<(), String> {
    let st = state();
    let _operation = st.operation.lock().await;
    let session = st.session.lock().await.take();
    if let Some(session) = session {
        session.close().await.map_err(|e| e.to_string())?;
        info!("全局快捷键已通过 portal 解绑");
    }
    Ok(())
}

/// 打开系统侧的快捷键配置界面（需 portal version >= 2）
pub async fn configure_shortcuts() -> Result<(), String> {
    let st = state();
    let proxy = {
        let guard = st.proxy.lock().await;
        Arc::clone(
            guard
                .as_ref()
                .ok_or_else(|| "portal 尚未初始化".to_string())?,
        )
    };
    let _operation = st.operation.lock().await;
    let session_guard = st.session.lock().await;
    let session = session_guard
        .as_ref()
        .ok_or_else(|| "当前没有绑定中的全局快捷键".to_string())?;

    proxy
        .configure_shortcuts(session, None, Default::default())
        .await
        .map_err(|e| format!("打开系统快捷键设置失败: {e}"))
}

/// 注册激活回调（可随时注册，后续激活事件都会回调）
pub fn on_activated(cb: ActivatedCallback) {
    *state()
        .activated_cb
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(cb);
}

/// 关闭并清理资源（应用退出时调用，fire-and-forget 即可）
pub async fn shutdown() {
    let st = state();
    let _operation = st.operation.lock().await;
    if let Some(session) = st.session.lock().await.take() {
        let _ = session.close().await;
    }
    // 释放激活回调，解除对 Node 环境的强引用，允许进程正常退出
    let _ = st
        .activated_cb
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    info!("linux-portal 已关闭");
}

/// 启动 Activated 信号监听（仅启动一次，进程生命周期内常驻）
fn spawn_activated_listener(proxy: Arc<GlobalShortcuts>) {
    static SPAWNED: AtomicBool = AtomicBool::new(false);
    if SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    tokio::spawn(activated_loop(proxy));
}

/// 持续监听 Activated 信号并把触发动作 id 回调给 Electron 侧
async fn activated_loop(proxy: Arc<GlobalShortcuts>) {
    let mut stream = match proxy.receive_activated().await {
        Ok(s) => s,
        Err(e) => {
            error!(error = %e, "订阅 Activated 信号失败");
            return;
        }
    };
    while let Some(activated) = stream.next().await {
        let id = activated.shortcut_id().to_string();
        debug!(session = %activated.session_handle().as_str(), shortcut = %id, "portal 全局快捷键触发");
        let cb = state()
            .activated_cb
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(cb) = cb.as_ref() {
            cb.call(Ok(id), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
    warn!("Activated 信号流已结束");
}
