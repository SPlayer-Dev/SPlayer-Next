/**
 * 快捷键系统类型
 */

/** 可绑定动作 ID */
export type HotkeyActionId =
  | "player.togglePlay"
  | "player.next"
  | "player.prev"
  | "player.seekForward"
  | "player.seekBack"
  | "player.volumeUp"
  | "player.volumeDown"
  | "player.cycleRepeat"
  | "player.toggleShuffle"
  | "window.toggleDesktopLyric"
  | "window.toggleDynamicIsland"
  | "window.toggleTaskbarLyric"
  | "view.openPlayer"
  | "view.closePlayer"
  | "view.togglePlaylist";

/** 单个动作的两条作用域绑定 */
export interface HotkeyBinding {
  /** Electron Accelerator 字符串；null 表示未绑定 */
  inApp: string | null;
  /** 同上，作用范围为系统全局 */
  global: string | null;
}

/** 全部动作的绑定表 */
export type HotkeyBindingsMap = Record<HotkeyActionId, HotkeyBinding>;

/** 完整快捷键配置 */
export interface HotkeyConfig {
  /** 是否启用全局快捷键（关闭时不向系统注册任何 globalShortcut） */
  globalEnabled: boolean;
  /** 各动作的绑定 */
  bindings: HotkeyBindingsMap;
}

/** 动作元数据 */
export interface HotkeyActionMeta {
  id: HotkeyActionId;
  /** i18n key */
  labelKey: string;
  /** 出厂默认绑定 */
  defaultBinding: HotkeyBinding;
  /** 是否允许全局绑定 */
  allowGlobal: boolean;
}

/** 冲突项 */
export interface HotkeyConflict {
  id: HotkeyActionId;
  scope: "inApp" | "global";
  reason: "duplicate" | "os-occupied" | "invalid";
  /** 重复占用的另一动作 id（reason=duplicate 时） */
  conflictWith?: HotkeyActionId;
}

export interface HotkeyApi {
  /** 拉取完整配置 */
  getAll: () => Promise<HotkeyConfig>;
  /** 设置某动作的绑定，主进程同步重注册 globalShortcut，返回最新全量 */
  set: (id: HotkeyActionId, binding: HotkeyBinding) => Promise<HotkeyConfig>;
  /** 重置：传 id 重置单项；不传则全部 */
  reset: (id?: HotkeyActionId) => Promise<HotkeyConfig>;
  /** 切换全局快捷键总开关 */
  setGlobalEnabled: (enabled: boolean) => Promise<HotkeyConfig>;
  /** 探测某 accelerator 在系统层是否可注册（仅 global 录入预校验用） */
  probe: (accelerator: string) => Promise<boolean>;
  /** 拉取当前冲突快照（init 时使用，避免错过启动时已 broadcast 的事件） */
  getConflicts: () => Promise<HotkeyConflict[]>;
  /** 主进程触发某动作（global 命中后转回渲染端 dispatch） */
  onTrigger: (callback: (id: HotkeyActionId) => void) => () => void;
  /** 主进程上报当前冲突列表 */
  onConflicts: (callback: (conflicts: HotkeyConflict[]) => void) => () => void;
}
