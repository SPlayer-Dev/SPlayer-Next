use napi_derive::napi;

/// 单个要绑定到 portal 的全局快捷键
#[napi(object)]
#[derive(Debug, Clone)]
pub struct PortalShortcut {
    /// 固定动作 id（与 Electron 侧 HotkeyActionId 一致）
    pub id: String,
    /// 本地化描述（labelKey 对应的文本）
    pub description: String,
    /// preferred_trigger（XDG shortcuts 规范语法，如 "CTRL+SHIFT+space"）
    pub preferred_trigger: Option<String>,
}

/// portal 后端能力探测结果
#[napi(object)]
#[derive(Debug)]
pub struct PortalCapability {
    /// 是否支持 GlobalShortcuts 接口
    pub supported: bool,
    /// portal 接口版本
    pub version: u32,
    /// 是否支持 ConfigureShortcuts（version >= 2）
    pub configure_supported: bool,
    /// 探测失败时的错误信息
    pub error: Option<String>,
}

/// portal 操作结果
#[napi(object)]
#[derive(Debug)]
pub struct PortalResult {
    pub ok: bool,
    pub error: Option<String>,
}
