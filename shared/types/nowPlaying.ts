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
  /** 播放速度倍率（0.5 ~ 2.0） */
  speed: number;
  /** 当前曲目的歌词偏移（ms，正值为歌词提前） */
  lyricOffsetMs: number;
  /** position 真实成立的主进程时钟（Date.now 毫秒），接收端用于补偿其过期时长 */
  sendTimestamp: number;
}

/** 主进程 → 窗口：播放位置锚点 */
export interface NowPlayingPositionSync {
  position: number;
  playing: boolean;
  /** 播放速度倍率（0.5 ~ 2.0） */
  speed: number;
  sendTimestamp: number;
}

/** 主进程 → 渲染端 / 窗口：当前曲目歌词偏移变化（切歌或用户调整） */
export interface NowPlayingLyricOffsetSync {
  /** 对应的 Track.id；null 表示当前无曲目 */
  trackId: string | null;
  /** 当前偏移（ms） */
  offsetMs: number;
}

/** NowPlaying API */
export interface NowPlayingApi {
  /** 同步当前播放状态到主进程 */
  update: (payload: NowPlayingUpdatePayload) => void;
  /** 拉取当前完整快照 */
  requestSnapshot: () => Promise<NowPlayingSnapshot>;
  /** 写入指定曲目的歌词偏移（ms）；0 视为清除 */
  setLyricOffset: (trackId: string, offsetMs: number) => void;
  /** 订阅歌曲切换 */
  onTrackChange: (callback: (data: { track: Track | null }) => void) => () => void;
  /** 订阅歌词内容变化 */
  onLyricChange: (callback: (snapshot: NowPlayingSnapshot) => void) => () => void;
  /** 订阅播放位置锚点 */
  onPositionSync: (callback: (data: NowPlayingPositionSync) => void) => () => void;
  /** 订阅当前曲目歌词偏移变化 */
  onLyricOffsetChange: (callback: (data: NowPlayingLyricOffsetSync) => void) => () => void;
}
