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

/** 窗口状态 */
export interface WindowState {
  /** 窗口宽度 */
  width: number;
  /** 窗口高度 */
  height: number;
  /** 是否最大化 */
  maximized: boolean;
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
  /** 系统配置 */
  system: {
    /** 记忆窗口状态（大小、位置、是否最大化） */
    rememberWindowState: boolean;
    /** 在任务栏显示播放进度 */
    taskbarProgress: boolean;
    /** 窗口状态（主进程自动保存） */
    window: WindowState;
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
