import type { Platform } from "./platform";
import type { Track, PlayerState, RepeatMode, ShuffleMode } from "./player";

export interface PlaybackStatusSnapshot {
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  volume: number;
  isFinished: boolean;
  /** 当前曲目在整个队列中的索引，无当前队列项时为 -1 */
  currentIndex: number;
  repeat: RepeatMode;
  shuffle: ShuffleMode;
}

/** 播放队列分页参数 */
export interface PlaybackQueueOptions {
  offset?: number;
  limit?: number;
}

/** 按当前播放顺序读取的队列快照 */
export interface PlaybackQueueSnapshot {
  tracks: Track[];
  total: number;
  /** 当前曲目在整个队列中的索引，无当前队列项时为 -1 */
  currentIndex: number;
  offset: number;
}

export interface OnlineSearchOptions {
  platform: Platform;
  query: string;
  page?: number;
  limit?: number;
}

export interface OnlineSearchResult {
  platform: Platform;
  page: number;
  total: number;
  hasMore: boolean;
  tracks: Track[];
}
