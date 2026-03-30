/** 播放器背景类型 */
export type PlayerBgType = "blur" | "solid";

/** 歌词渲染模式 */
export type LyricMode = "effects" | "simple";

/** 布局模式 */
export type LayoutMode = "default" | "sidebar-full" | "floating";

/** 弹簧动画预设 */
export type SpringPreset =
  | "default"
  | "smooth"
  | "responsive"
  | "jello"
  | "heavy"
  | "noBounce"
  | "custom";

/** 弹簧预设参数映射 */
export const SPRING_PRESETS: Record<
  Exclude<SpringPreset, "custom">,
  { mass: number; damping: number; stiffness: number }
> = {
  default: { mass: 0.9, damping: 15, stiffness: 90 },
  smooth: { mass: 1.2, damping: 22, stiffness: 80 },
  responsive: { mass: 0.5, damping: 18, stiffness: 150 },
  jello: { mass: 0.6, damping: 8, stiffness: 120 },
  heavy: { mass: 2.0, damping: 25, stiffness: 60 },
  noBounce: { mass: 1.0, damping: 30, stiffness: 100 },
};

/** 歌词设置 */
export interface LyricSettings {
  /** 歌词渲染模式 */
  lyricMode: LyricMode;
  /** 字号自适应窗口大小 */
  adaptiveFontSize: boolean;
  /** 歌词字号（px，自适应关闭时生效） */
  fontSize: number;
  /** 歌词字重（100~900） */
  fontWeight: number;
  /** 是否显示翻译歌词 */
  showTranslation: boolean;
  /** 是否显示音译歌词 */
  showRomanization: boolean;
  /** 逐字高亮效果 */
  enableWordHighlight: boolean;
  /** 逐字上浮动画 */
  enableFloatAnimation: boolean;
  /** 强调效果（缩放 + 辉光 + 正弦浮动） */
  enableEmphasizeEffect: boolean;
  /** 逐行模糊效果 */
  enableBlur: boolean;
  /** 隐藏已播放行 */
  hidePassedLines: boolean;
  /** 弹簧动画预设 */
  springPreset: SpringPreset;
  /** 弹簧质量 */
  springMass: number;
  /** 弹簧阻尼 */
  springDamping: number;
  /** 弹簧刚度 */
  springStiffness: number;
  /** 激活行对齐位置（0~1） */
  alignPosition: number;
  /** 逐字掩码渐变宽度 */
  wordFadeWidth: number;
  /** 非激活行透明度 */
  inactiveAlpha: number;
}

/** 播放器设置 */
export interface PlayerSettings {
  /** 播放器背景类型 */
  playerBgType: PlayerBgType;
  /** 无歌词时自动居中封面并隐藏歌词区域 */
  autoCenterCover: boolean;
  /** 颜色是否跟随封面 */
  followCoverColor: boolean;
  /** 布局模式：default（默认）| sidebar-full（侧边栏全高）| floating（悬浮播放栏） */
  layoutMode: LayoutMode;
}
