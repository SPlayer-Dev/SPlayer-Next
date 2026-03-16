/** 歌词格式 */
export type LyricFormat = "ttml" | "lys" | "yrc" | "qrc" | "eslrc" | "lrc";

/** 同目录下的一条外部歌词文件 */
export interface ExternalLyric {
  /** 歌词格式 */
  format: LyricFormat;
  /** 歌词内容 */
  content: string;
}

/** 歌曲完整元信息（加载时一次性返回，含歌词、封面、基本信息） */
export interface MusicMetadata {
  /** 标题 */
  title?: string;
  /** 艺术家 */
  artist?: string;
  /** 专辑 */
  album?: string;
  /** 时长（秒） */
  duration: number;
  /** 采样率 */
  sampleRate: number;
  /** 声道数 */
  channels: number;
  /** 内嵌歌词（从音频文件 tag 中读取） */
  embeddedLyric?: string;
  /** 同目录下找到的所有外部歌词文件 */
  externalLyrics: ExternalLyric[];
  /** 封面图片 URL（splayer-file:// 协议，可直接用作 img src） */
  coverPath?: string;
}

/** 播放器状态快照 */
export interface PlayerStatus {
  /** 播放状态 */
  state: "idle" | "playing" | "paused" | "stopped";
  /** 当前播放位置（秒） */
  position: number;
  /** 总时长（秒） */
  duration: number;
  /** 音量（0.0 ~ 1.0） */
  volume: number;
  /** 是否已播放完毕 */
  isFinished: boolean;
}

/** 主进程推送给渲染进程的播放事件 */
export type PlayerEvent =
  | { type: "status"; data: PlayerStatus }
  | { type: "ended" }
  | { type: "error"; error: string };

/** IPC 响应包装 */
export interface IpcResponse<T = void> {
  /** 是否成功 */
  success: boolean;
  /** 返回数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
}

/** 通过 preload 暴露的播放器 API */
export interface PlayerApi {
  /** 加载音频源（本地路径或网络地址），返回完整元信息 */
  load: (source: string) => Promise<IpcResponse<MusicMetadata>>;
  /** 恢复播放 */
  play: () => Promise<IpcResponse>;
  /** 暂停播放 */
  pause: () => Promise<IpcResponse>;
  /** 停止播放 */
  stop: () => Promise<IpcResponse>;
  /** 跳转到指定位置（秒） */
  seek: (position: number) => Promise<IpcResponse>;
  /** 设置音量（0.0 ~ 1.0） */
  setVolume: (volume: number) => Promise<IpcResponse>;
  /** 获取当前音量 */
  getVolume: () => Promise<IpcResponse<number>>;
  /** 获取播放状态快照 */
  getStatus: () => Promise<IpcResponse<PlayerStatus>>;
  /** 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0） */
  getFftData: () => Promise<IpcResponse<number[]>>;
  /** 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用 */
  setFadeDuration: (ms: number) => Promise<IpcResponse>;
  /** 获取当前渐变时长（毫秒） */
  getFadeDuration: () => Promise<IpcResponse<number>>;
  /** 打开文件选择对话框，返回选中的音频文件路径 */
  openFile: () => Promise<IpcResponse<string>>;
  /** 订阅主进程推送的播放事件，返回取消订阅函数 */
  onEvent: (callback: (event: PlayerEvent) => void) => () => void;
}
