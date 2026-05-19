import type { LyricFormat } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER as DEFAULT_LYRIC_FORMAT_ORDER_SHARED } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";

/** 播放器背景类型 */
export type PlayerBgType = "blur" | "solid";

/**
 * 歌词来源偏好
 * - auto：智能选择（按打分结果）
 * - qqmusic / kugou / netease：优先该平台
 * - self：跟随歌曲自身来源平台
 */
export type LyricSourcePreference = "auto" | "qqmusic" | "kugou" | "netease" | "self";

/** 布局模式 */
export type LayoutMode = "default" | "sidebar-full" | "floating";

/** 路由切换动效 */
export type RouteTransition = "none" | "fade" | "slide" | "zoom";

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

/** 音源排序：来源偏好为「智能选择」时，按此顺序依次尝试匹配 */
export type LyricSourceOrder = Platform[];

/** 歌词格式优先级：决定多种格式可用时的选择，以及 TTML 是否覆盖平台主格式 */
export type LyricFormatOrder = LyricFormat[];

/** 默认音源顺序 */
export const DEFAULT_LYRIC_SOURCE_ORDER: LyricSourceOrder = ["netease", "qqmusic", "kugou"];

/** 默认格式优先级（来自 shared/types/lyrics 的单一来源） */
export const DEFAULT_LYRIC_FORMAT_ORDER: LyricFormatOrder = [...DEFAULT_LYRIC_FORMAT_ORDER_SHARED];

/** 歌词设置 */
export interface LyricSettings {
  /** 歌词来源偏好 */
  lyricSourcePreference: LyricSourcePreference;
  /** 音源顺序 */
  lyricSourceOrder: LyricSourceOrder;
  /** 歌词格式优先级 */
  lyricFormatOrder: LyricFormatOrder;
  /** 智能选择是否优先在线 */
  smartPreferOnline: boolean;
  /** 字号自适应窗口大小 */
  adaptiveFontSize: boolean;
  /** 歌词字号（px，自适应关闭时生效） */
  fontSize: number;
  /** 歌词字重（100~900） */
  fontWeight: number;
  /** 歌词字体 */
  fontFamily: string;
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
  /** 启用歌词排除 */
  enableExcludeLyrics: boolean;
  /** 用户自定义关键词 */
  excludeLyricsUserKeywords: string[];
  /** 用户自定义正则 */
  excludeLyricsUserRegexes: string[];
}

/** 播放器设置 */
export interface PlayerSettings {
  /** 播放器背景类型 */
  playerBgType: PlayerBgType;
  /** 无歌词时自动居中封面并隐藏歌词区域 */
  autoCenterCover: boolean;
  /** 颜色是否跟随封面 */
  followCoverColor: boolean;
  /** 全屏播放器自动进入沉浸模式（隐藏顶/底栏与鼠标） */
  autoImmersive: boolean;
  /** 输出设备名称，null 表示跟随系统默认 */
  outputDevice: string | null;
  /** 是否启用音乐频谱可视化 */
  enableSpectrum: boolean;
  /** 频谱单条宽度（px） */
  spectrumBarWidth: number;
}

/** 外观设置 */
export interface AppearanceSettings {
  /** 布局模式 */
  layoutMode: LayoutMode;
  /** 路由切换动效 */
  routeTransition: RouteTransition;
  /** 侧边栏折叠 */
  sidebarCollapsed: boolean;
  /** 侧边栏歌单项显示封面 */
  sidebarPlaylistCover: boolean;
  /** 点击关闭按钮的行为 */
  closeAction: "quit" | "hide";
  /** 记忆关闭选择 */
  rememberCloseChoice: boolean;
  /** 全局字体 */
  fontFamily: string;
}
