import type { DesktopLyricSettings } from "./settings";

/** 窗口管理 API */
export interface WindowApi {
  /** 切换桌面歌词窗口（开则关、关则开），返回切换后是否打开 */
  toggleDesktopLyric: () => Promise<boolean>;
  /** 关闭桌面歌词窗口 */
  closeDesktopLyric: () => Promise<void>;
  /** 查询桌面歌词窗口是否处于打开状态 */
  isDesktopLyricOpen: () => Promise<boolean>;
}

/** 桌面歌词 API */
export interface DesktopLyricApi {
  /** 订阅配置变化 */
  onConfigChange: (callback: (config: DesktopLyricSettings) => void) => () => void;
  /** 将窗口高度锁定到指定像素 */
  setHeight: (height: number) => Promise<void>;
  /** 锁定态下切换鼠标穿透（悬停解锁按钮时临时放开） */
  setMouseIgnore: (ignore: boolean) => void;
  /** 自定义拖拽移动窗口（传完整 bounds 规避 DPI 缩放 bug） */
  move: (x: number, y: number, width: number, height: number) => void;
  /** 拖拽开始 / 结束时钉住 / 释放最大尺寸 */
  freezeSize: (freeze: boolean) => void;
  /** 查询窗口真实 bounds（高 DPI 下 window.screenX 不可靠） */
  getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
}
