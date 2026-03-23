/** 主题模式 */
export type ThemeMode = "light" | "dark" | "system";

/** 主题颜色来源 */
export type ThemeSource = "default" | "custom" | "cover" | "solid";

/** 主题色板（值为 "R G B" 格式，用于 CSS rgb() / <alpha-value>） */
export interface ThemePalette {
  /** 主色 */
  primary: string;
  /** 主色容器（按钮背景等） */
  primaryContainer: string;
  /** 主色上的文字 */
  onPrimary: string;
  /** 主色容器上的文字 */
  onPrimaryContainer: string;
  /** 次要色 */
  secondary: string;
  /** 次要色容器 */
  secondaryContainer: string;
  /** 主背景 */
  surface: string;
  /** 次级背景（卡片、悬浮等） */
  surfaceAlt: string;
  /** 面板背景（侧边栏、播放栏等） */
  surfacePanel: string;
  /** 高亮浮层背景（弹出框、下拉菜单等） */
  surfaceBright: string;
  /** 背景上的主文字 */
  onSurface: string;
  /** 背景上的次级文字 */
  onSurfaceVariant: string;
  /** 边框/分割线 */
  outline: string;
  /** 淡边框 */
  outlineVariant: string;
}
