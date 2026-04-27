import type { LyricFormat } from "./lyrics";
import type { Platform } from "./platform";

/** 播放器状态 */
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "stopped";

/** 循环模式 */
export type RepeatMode = "off" | "list" | "one";

/** 随机模式 */
export type ShuffleMode = "off" | "on";

/** 歌曲来源 */
export type TrackSource = "local" | "online";

/** 歌手 */
export interface Artist {
  id?: string;
  name: string;
  avatar?: string;
}

/** 专辑 */
export interface Album {
  id?: string;
  name: string;
}

/** 音质信息 */
export interface AudioQuality {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  bitRate: number;
  codec: string;
}

/** 歌曲信息 */
export interface Track {
  id: string;
  source: TrackSource;
  /** 在线平台 */
  platform?: Platform;
  /** 本地路径 */
  path?: string;
  /** 标题 */
  title: string;
  /** 注释/副标题 */
  comment?: string;
  /** 歌手 */
  artists: Artist[];
  /** 专辑 */
  album?: Album;
  /** 时长（毫秒） */
  duration: number;
  /** 封面 */
  cover?: string;
  /** 原始封面 */
  coverOriginal?: string;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 修改时间（Unix ms） */
  mtime?: number;
  /** 创建时间（Unix ms） */
  ctime?: number;
  /** 音质信息 */
  quality?: AudioQuality;
}

/** 歌曲详细信息 */
export interface TrackDetail {
  quality: AudioQuality;
  embeddedLyric?: string;
  /** 外部歌词文件列表（同目录下扫描到的所有歌词文件） */
  externalLyrics: { format: LyricFormat; path: string }[];
}

/** 播放器加载后返回的完整数据 */
export interface LoadResult {
  track: Track;
  detail: TrackDetail;
}

/** 播放器状态快照 */
export interface PlayerStatus {
  state: PlayerState;
  position: number;
  duration: number;
  volume: number;
  isFinished: boolean;
}

/** 音频输出设备 */
export interface AudioDevice {
  name: string;
  isDefault: boolean;
}

/** 主进程推送给渲染进程的播放事件 */
export type PlayerEvent =
  | { type: "status"; data: PlayerStatus }
  | { type: "position"; data: { position: number; duration: number } }
  | { type: "ended" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "setShuffle"; data: { mode: ShuffleMode } }
  | { type: "setRepeat"; data: { mode: RepeatMode } }
  | { type: "fftData"; data: number[] }
  | { type: "error"; error: string }
  | { type: "deviceChanged"; data: { defaultDevice: string | null } };

/** IPC 响应包装 */
export interface IpcResponse<T = void> {
  success: boolean;
  data?: T;
  /** 错误码（对应 ErrorCode 枚举） */
  error?: string;
}

/** 播放器 API */
export interface PlayerApi {
  /** 加载音频（本地路径或网络地址） */
  load: (source: string, autoPlay?: boolean) => Promise<IpcResponse<LoadResult>>;
  /** 恢复播放 */
  play: () => Promise<IpcResponse>;
  /** 暂停播放 */
  pause: () => Promise<IpcResponse>;
  /** 停止播放 */
  stop: () => Promise<IpcResponse>;
  /** 跳转到指定位置（毫秒） */
  seek: (positionMs: number) => Promise<IpcResponse>;
  /** 设置音量（0.0 ~ 1.0） */
  setVolume: (volume: number) => Promise<IpcResponse>;
  /** 获取当前音量 */
  getVolume: () => Promise<IpcResponse<number>>;
  /** 获取播放状态快照 */
  getStatus: () => Promise<IpcResponse<PlayerStatus>>;
  /** 设置 FFT 频谱推送 */
  setFftEnabled: (enabled: boolean) => Promise<IpcResponse>;
  /** 获取 FFT 频谱数据 */
  getFftData: () => Promise<IpcResponse<number[]>>;
  /** 设置渐入渐出时长（毫秒） */
  setFadeDuration: (ms: number) => Promise<IpcResponse>;
  /** 获取渐入渐出时长（毫秒） */
  getFadeDuration: () => Promise<IpcResponse<number>>;
  /** 获取原始高清封面（base64 data URL） */
  getCoverRaw: () => Promise<IpcResponse<string | null>>;
  /** 读取外部歌词文件内容 */
  readLyricFile: (filePath: string) => Promise<IpcResponse<string>>;
  /** 重建音频输出设备 */
  reinit: () => Promise<IpcResponse>;
  /** 设置音量均衡 */
  setNormalizationEnabled: (enabled: boolean) => Promise<IpcResponse>;
  /** 启用/禁用 10 频段均衡器 */
  setEqualizerEnabled: (enabled: boolean) => Promise<IpcResponse>;
  /** 更新均衡器各频段增益（dB 数组，长度 10） */
  setEqualizerBands: (gainsDb: number[]) => Promise<IpcResponse>;
  /** 设置前级增益（dB） */
  setPreampGain: (preampDb: number) => Promise<IpcResponse>;
  /** 获取所有音频输出设备 */
  getOutputDevices: () => Promise<IpcResponse<AudioDevice[]>>;
  /** 获取系统默认输出设备名称 */
  getDefaultDeviceName: () => Promise<IpcResponse<string | null>>;
  /** 切换输出设备（传 null 使用系统默认） */
  setOutputDevice: (deviceName: string | null) => Promise<IpcResponse>;
  /** 获取当前选择的输出设备名称 */
  getSelectedDeviceName: () => Promise<IpcResponse<string | null>>;
  /** 同步播放模式到托盘 */
  syncPlayMode: (repeatMode: string, shuffleMode: string) => void;
  /** 广播播放控制事件 */
  dispatch: (type: string) => void;
  /** 订阅播放事件 */
  onEvent: (callback: (event: PlayerEvent) => void) => () => void;
}
