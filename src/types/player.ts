import type { Track, TrackDetail } from "./song";

/** 播放器加载后返回的完整数据（IPC 层组装） */
export interface LoadResult {
  /** 歌曲轻量信息 */
  track: Track;
  /** 歌曲详细信息 */
  detail: TrackDetail;
}

/** 播放器状态 */
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "stopped";

/** 播放器状态快照 */
export interface PlayerStatus {
  /** 播放状态 */
  state: PlayerState;
  /** 当前播放位置（毫秒） */
  position: number;
  /** 总时长（毫秒） */
  duration: number;
  /** 音量（0.0 ~ 1.0） */
  volume: number;
  /** 是否已播放完毕 */
  isFinished: boolean;
}

/** 主进程推送给渲染进程的播放事件 */
export type PlayerEvent =
  | { type: "status"; data: PlayerStatus }
  | { type: "position"; data: { position: number; duration: number } }
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
  /** 加载音频源（本地路径或网络地址），返回歌曲信息 + 详情 */
  load: (source: string) => Promise<IpcResponse<LoadResult>>;
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
