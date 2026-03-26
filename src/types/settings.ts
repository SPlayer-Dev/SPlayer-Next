import type { ThemeMode, ThemeSource } from "./theme";

/** 播放器背景类型 */
export type PlayerBgType = "blur" | "solid";

/** 外观设置 */
export interface AppearanceSettings {
  /** 主题模式 */
  themeMode: ThemeMode;
  /** 颜色来源 */
  themeSource: ThemeSource;
  /** 自定义主色 HEX */
  customColor: string;
  /** 全局着色开关 */
  globalTint: boolean;
}

/** 播放器设置 */
export interface PlayerSettings {
  /** 播放器背景类型 */
  playerBgType: PlayerBgType;
}
