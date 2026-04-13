/** 支持的语言代码 */
export type LocaleCode = "zh-CN" | "en-US";

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
  /** 显示翻译 */
  showTranslation: boolean;
  /** 双行显示 */
  doubleLine: boolean;
  /** 对齐方式 */
  align: DesktopLyricAlign;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 已播放颜色 */
  playedColor: string;
  /** 未播放颜色 */
  unplayedColor: string;
  /** 翻译文本颜色 */
  translationColor: string;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 锁定：鼠标穿透、禁止拖动 */
  locked: boolean;
}

/** 音乐库配置 */
export interface LibrarySettings {
  /** 扫描目录列表 */
  scanDirs: string[];
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
  /** 系统配置 */
  system: {
    /** 记忆窗口状态 */
    rememberWindowState: boolean;
    /** 在任务栏显示播放进度 */
    taskbarProgress: boolean;
  };
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
