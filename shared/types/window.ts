import type { DesktopLyricSettings } from "./settings";

/** 窗口管理 API */
export interface WindowApi {
  /** 切换桌面歌词窗口（开则关、关则开），返回切换后是否打开 */
  toggleDesktopLyric: () => Promise<boolean>;
  /** 查询桌面歌词窗口是否处于打开状态 */
  isDesktopLyricOpen: () => Promise<boolean>;
}

/** 桌面歌词 API */
export interface DesktopLyricApi {
  /** 订阅配置变化 */
  onConfigChange: (callback: (config: DesktopLyricSettings) => void) => () => void;
}
