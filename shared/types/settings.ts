import type { PluginsConfig } from "./plugin";
import type { HotkeyConfig } from "./hotkey";
import type { StreamingServerConfig } from "./streaming";

/** 支持的语言代码 */
export type LocaleCode = "zh-CN" | "en-US";

/** 均衡器预设标识 */
export type EqualizerPreset =
  | "flat"
  | "custom"
  | "pop"
  | "rock"
  | "classical"
  | "electronic"
  | "bass"
  | "vocal"
  | "dance"
  | "soft";

/** 均衡器配置 */
export interface EqualizerSettings {
  /** 是否启用均衡器 */
  enabled: boolean;
  /** 当前选中的预设 */
  preset: EqualizerPreset;
  /** 10 频段增益（dB），范围 [-15, 15]，对应 31/62/125/250/500/1k/2k/4k/8k/16k Hz */
  bands: number[];
  /** 前级增益（dB），范围 [-12, 12] */
  preamp: number;
}

/** 播放器配置 */
export interface PlayerSettings {
  /** 加载后自动播放 */
  autoPlay: boolean;
  /** 记忆上次播放的歌曲 */
  rememberLastTrack: boolean;
  /** 是否启用渐入渐出 */
  fadeEnabled: boolean;
  /** 渐入渐出时长（毫秒） */
  fadeDuration: number;
  /** 输出设备名称，null 为系统默认 */
  outputDevice: string | null;
  /** 默认音量（0.0 ~ 1.0） */
  volume: number;
  /** 音量均衡（响度归一化） */
  loudnessNormalization: boolean;
  /** 均衡器配置 */
  equalizer: EqualizerSettings;
}

/** Discord 显示模式 */
export type DiscordDisplayMode = "name" | "state" | "details";

/** Discord RPC 配置 */
export interface DiscordSettings {
  /** 是否启用 */
  enabled: boolean;
  /** 暂停时是否显示状态 */
  showWhenPaused: boolean;
  /** 显示模式 */
  displayMode: DiscordDisplayMode;
}

/** 媒体集成配置 */
export interface MediaSettings {
  /** 是否启用系统媒体控件（SMTC / MPRIS / MPNowPlaying） */
  systemMediaControls: boolean;
  /** Discord RPC 配置 */
  discord: DiscordSettings;
}

/** 桌面歌词对齐方式 */
export type DesktopLyricAlign = "left" | "center" | "right" | "justify";

/** 桌面歌词配置 */
export interface DesktopLyricSettings {
  /** 字号 */
  fontSize: number;
  /** 字重 */
  fontWeight: number;
  /** 字体 */
  fontFamily: string;
  /** 显示翻译 */
  showTranslation: boolean;
  /** 双行显示 */
  doubleLine: boolean;
  /** 对齐方式 */
  align: DesktopLyricAlign;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 自动生成逐字效果 */
  autoGenerateWordByWord: boolean;
  /** 已播放颜色 */
  playedColor: string;
  /** 未播放颜色 */
  unplayedColor: string;
  /** 描边颜色 */
  strokeColor: string;
  /** 是否启用文本背景遮罩 */
  backgroundMask: boolean;
  /** 文本背景遮罩颜色 */
  backgroundMaskColor: string;
  /** 是否常驻显示歌曲信息 */
  alwaysShowSongInfo: boolean;
  /** 拖拽时是否把窗口限制在屏幕工作区内 */
  limitBounds: boolean;
  /** 歌词行切换动画 */
  animation: boolean;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 锁定：鼠标穿透、禁止拖动 */
  locked: boolean;
}

/** 灵动岛歌词配置 */
export interface DynamicIslandSettings {
  /** 缩放比例（0.5 ~ 2.0），1 = 100%；实际窗口高度由渲染端按基准高度 × 缩放算出 */
  scale: number;
  /** 字重 */
  fontWeight: number;
  /** 字体 */
  fontFamily: string;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 已播放颜色 */
  playedColor: string;
  /** 未播放颜色 */
  unplayedColor: string;
  /** 背景颜色 */
  backgroundColor: string;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 吸附时是否居中 */
  snapCentered: boolean;
  /** 非遮挡模式 */
  nonOcclusive: boolean;
  /** 总是双行 */
  doubleLine: boolean;
  /** 显示翻译 */
  showTranslation: boolean;
}

/** 任务栏歌词位置模式 */
export type TaskbarLyricPosition = "auto" | "left" | "right";

/** 任务栏歌词配色模式：taskbar=跟随任务栏主题，light=强制浅色，dark=强制深色 */
export type TaskbarLyricColorMode = "taskbar" | "light" | "dark";

/** 任务栏歌词配置（仅 Windows） */
export interface TaskbarLyricSettings {
  /** 位置：auto 根据任务栏对齐方式自动选择，left 固定左侧，right 固定右侧 */
  position: TaskbarLyricPosition;
  /** 宽度自动：开启时占满可用空间，关闭时按 maxWidth 限制 */
  autoMaxWidth: boolean;
  /** 最大宽度（逻辑像素）；仅在 autoMaxWidth 关闭时生效；超出可用空间时仍以可用空间为准 */
  maxWidth: number;
  /** 配色模式 */
  colorMode: TaskbarLyricColorMode;
  /** 双行显示（歌词 + 翻译 / 下一行） */
  doubleLine: boolean;
  /** 显示翻译（doubleLine 开启时，副行优先显示翻译，没有翻译则回退到下一行） */
  showTranslation: boolean;
  /** 显示封面 */
  showCover: boolean;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 字号（逻辑像素） */
  fontSize: number;
  /** 字体 */
  fontFamily: string;
}

/** 音乐库配置 */
export interface LibrarySettings {
  /** 扫描目录列表 */
  scanDirs: string[];
}

/** 在线歌词服务配置 */
export interface OnlineLyricSettings {
  /** 启用在线 TTML 歌词 */
  enableOnlineTTMLLyric: boolean;
  /** AMLL TTML DB 服务地址，需含 %s 占位符 */
  amllDbServer: string;
}

/** 流媒体服务器配置 */
export interface StreamingSettings {
  /** 已配置的服务器列表，密码字段已加密 */
  servers: StreamingServerConfig[];
  /** 当前激活的服务器 ID，未选择时为 null */
  activeServerId: string | null;
}

/** 主窗口几何 */
export interface MainWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

/** 桌面歌词窗口几何 */
export interface DesktopLyricWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  visible: boolean;
}

/** 灵动岛窗口几何 */
export interface DynamicIslandWindowState {
  /** snapped: 吸附到屏幕顶部；floating: 自由位置 */
  mode: "snapped" | "floating";
  /** floating: 窗口左上角 x；snapped + 非居中: 窗口中心点 x（让宽度变化时围绕中心对称伸缩） */
  x: number | null;
  /** floating: 窗口左上角 y；snapped + 非居中: 当时所在屏 workArea.y（用于找回所在屏） */
  y: number | null;
  visible: boolean;
}

/** 任务栏歌词窗口状态 */
export interface TaskbarLyricWindowState {
  visible: boolean;
}

/** 窗口几何状态 */
export interface WindowStates {
  main: MainWindowState;
  desktopLyric: DesktopLyricWindowState;
  dynamicIsland: DynamicIslandWindowState;
  taskbarLyric: TaskbarLyricWindowState;
}

/** 后端配置汇总 */
export interface SystemConfig {
  /** 播放器配置 */
  player: PlayerSettings;
  /** 媒体集成配置 */
  media: MediaSettings;
  /** 音乐库配置 */
  library: LibrarySettings;
  /** 桌面歌词配置 */
  desktopLyric: DesktopLyricSettings;
  /** 灵动岛歌词配置 */
  dynamicIsland: DynamicIslandSettings;
  /** 任务栏歌词配置（仅 Windows） */
  taskbarLyric: TaskbarLyricSettings;
  /** 在线歌词服务配置 */
  lyric: OnlineLyricSettings;
  /** 流媒体服务器配置 */
  streaming: StreamingSettings;
  /** 系统配置 */
  system: {
    /** 记忆窗口状态 */
    rememberWindowState: boolean;
    /** 在任务栏显示播放进度 */
    taskbarProgress: boolean;
  };
  /** 窗口几何状态（运行时自动记录，非用户主动配置） */
  windowStates: WindowStates;
  /** 插件系统配置 */
  plugins: PluginsConfig;
  /** 快捷键配置（独立于其他配置，由 hotkey 模块独占） */
  hotkeys: HotkeyConfig;
}

/** 配置 API */
export interface ConfigApi {
  /** 获取单个配置项（点号路径，如 "player.fadeDuration"） */
  get: (keyPath: string) => Promise<unknown>;
  /** 写入单个配置项 */
  set: (keyPath: string, value: unknown) => Promise<void>;
  /** 获取全部配置 */
  getAll: () => Promise<SystemConfig>;
  /** 重置为默认值 */
  reset: () => Promise<void>;
}
