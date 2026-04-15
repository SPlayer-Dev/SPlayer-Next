import type { DesktopLyricSettings, DynamicIslandSettings } from "./settings";

/** 窗口管理 API */
export interface WindowApi {
  /** 切换桌面歌词窗口（开则关、关则开），返回切换后是否打开 */
  toggleDesktopLyric: () => Promise<boolean>;
  /** 关闭桌面歌词窗口 */
  closeDesktopLyric: () => Promise<void>;
  /** 查询桌面歌词窗口是否处于打开状态 */
  isDesktopLyricOpen: () => Promise<boolean>;
  /** 订阅桌面歌词窗口开关状态变化 */
  onDesktopLyricVisibilityChange: (callback: (open: boolean) => void) => () => void;
  /** 切换灵动岛窗口 */
  toggleDynamicIsland: () => Promise<boolean>;
  /** 关闭灵动岛窗口 */
  closeDynamicIsland: () => Promise<void>;
  /** 查询灵动岛窗口是否处于打开状态 */
  isDynamicIslandOpen: () => Promise<boolean>;
  /** 订阅灵动岛窗口开关状态变化 */
  onDynamicIslandVisibilityChange: (callback: (open: boolean) => void) => () => void;
}

/** 桌面歌词 API */
export interface DesktopLyricApi {
  /** 订阅配置变化 */
  onConfigChange: (callback: (config: DesktopLyricSettings) => void) => () => void;
  /** 将窗口高度锁定到指定像素 */
  setHeight: (height: number) => Promise<void>;
  /** 锁定态下切换鼠标穿透 */
  setMouseIgnore: (ignore: boolean) => void;
  /** 拖拽移动；只传位置，主进程持有权威尺寸 */
  move: (x: number, y: number) => void;
  /** 拖拽结束后存最终位置；程序 setBounds 不触发 moved 事件，需显式存 */
  saveState: () => void;
  /** 订阅主进程 screen 光标位置判定 */
  onCursorInside: (callback: (inside: boolean) => void) => () => void;
}

/** 灵动岛 API */
export interface DynamicIslandApi {
  /** 订阅配置变化 */
  onConfigChange: (callback: (config: DynamicIslandSettings) => void) => () => void;
  /** 拖拽移动；只传位置，主进程持有权威尺寸 */
  move: (x: number, y: number) => void;
  /** 拖拽结束后存最终位置；主进程在落点近顶部时会自动吸附回居中 */
  saveState: () => void;
  /** 订阅吸附模式变化 */
  onModeChange: (callback: (mode: "snapped" | "floating") => void) => () => void;
}
