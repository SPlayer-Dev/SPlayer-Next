/** 播放器状态 */
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "stopped";

/** 循环模式 */
export type RepeatMode = "off" | "list" | "one";

/** 随机模式 */
export type ShuffleMode = "off" | "on";

/** 歌曲来源 */
export type TrackSource = "local" | "online";

/** 歌词格式 */
export type LyricFormat = "ttml" | "lys" | "yrc" | "qrc" | "lrc" | "srt" | "ass";

/** 外部歌词文件 */
export interface ExternalLyric {
  format: LyricFormat;
  path: string;
}

/** 歌手 */
export interface Artist {
  id?: string;
  name: string;
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
  bitRate: number;
  codec: string;
}

/** 在线匹配信息 */
export interface OnlineMatch {
  id: string;
  artists?: Artist[];
  album?: Album;
  cover?: string;
  coverOriginal?: string;
}

/** 歌曲（轻量，用于播放列表） */
export interface Track {
  id: string;
  source: TrackSource;
  path?: string;
  title: string;
  artists: Artist[];
  album?: Album;
  duration: number;
  cover?: string;
  coverOriginal?: string;
  matched?: OnlineMatch;
}

/** 歌曲详细信息（按需加载） */
export interface TrackDetail {
  quality: AudioQuality;
  embeddedLyric?: string;
  externalLyrics: ExternalLyric[];
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
  error?: string;
}

/** 通过 preload 暴露的播放器 API */
export interface PlayerApi {
  probe: (source: string) => Promise<IpcResponse<Track>>;
  load: (source: string, autoPlay?: boolean) => Promise<IpcResponse<LoadResult>>;
  play: () => Promise<IpcResponse>;
  pause: () => Promise<IpcResponse>;
  stop: () => Promise<IpcResponse>;
  seek: (positionMs: number) => Promise<IpcResponse>;
  setVolume: (volume: number) => Promise<IpcResponse>;
  getVolume: () => Promise<IpcResponse<number>>;
  getStatus: () => Promise<IpcResponse<PlayerStatus>>;
  getFftData: () => Promise<IpcResponse<number[]>>;
  setFadeDuration: (ms: number) => Promise<IpcResponse>;
  getFadeDuration: () => Promise<IpcResponse<number>>;
  getCoverRaw: () => Promise<IpcResponse<string | null>>;
  readLyricFile: (filePath: string) => Promise<IpcResponse<string>>;
  openFile: () => Promise<IpcResponse<string>>;
  reinit: () => Promise<IpcResponse>;
  setFftEnabled: (enabled: boolean) => Promise<IpcResponse>;
  getOutputDevices: () => Promise<IpcResponse<AudioDevice[]>>;
  getDefaultDeviceName: () => Promise<IpcResponse<string | null>>;
  setOutputDevice: (deviceName: string | null) => Promise<IpcResponse>;
  getSelectedDeviceName: () => Promise<IpcResponse<string | null>>;
  syncPlayMode: (repeatMode: string, shuffleMode: string) => void;
  onEvent: (callback: (event: PlayerEvent) => void) => () => void;
}
