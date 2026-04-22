import type { Track } from "./player";
import type { LyricLine, LyricData } from "./lyrics";

/** 渲染进程 → 主进程：同步当前播放状态（track + 歌词 + 源） */
export interface NowPlayingUpdatePayload {
  track: Track | null;
  lyric: LyricLine[];
  source: LyricData;
}

/** 主进程 → 窗口：当前播放的完整快照 */
export interface NowPlayingSnapshot {
  track: Track | null;
  lyric: LyricLine[];
  source: LyricData;
  position: number;
  playing: boolean;
  /** 发送时刻的主进程时钟（Date.now 毫秒），接收端用于补偿 IPC 延迟 */
  sendTimestamp: number;
}

/** 主进程 → 窗口：播放位置锚点 */
export interface NowPlayingPositionSync {
  position: number;
  playing: boolean;
  sendTimestamp: number;
}

/** NowPlaying API */
export interface NowPlayingApi {
  /** 同步当前播放状态到主进程 */
  update: (payload: NowPlayingUpdatePayload) => void;
  /** 拉取当前完整快照 */
  requestSnapshot: () => Promise<NowPlayingSnapshot>;
  /** 订阅歌曲切换 */
  onTrackChange: (callback: (data: { track: Track | null }) => void) => () => void;
  /** 订阅歌词内容变化 */
  onLyricChange: (callback: (snapshot: NowPlayingSnapshot) => void) => () => void;
  /** 订阅播放位置锚点 */
  onPositionSync: (callback: (data: NowPlayingPositionSync) => void) => () => void;
}
