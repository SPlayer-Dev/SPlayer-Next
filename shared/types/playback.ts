import type { Track } from "@shared/types/player";

/** 循环模式（右侧按钮） */
export type RepeatMode = "off" | "list" | "one";

/** 随机模式（左侧按钮，与循环模式独立） */
export type ShuffleMode = "off" | "on";

/** 主进程推送给渲染进程的播放控制事件 */
export type PlaybackEvent =
  | { type: "queue:changed"; data: { currentIndex: number; length: number } }
  | { type: "queue:trackChanged"; data: { currentIndex: number; track: Track } }
  | { type: "queue:ended" }
  | { type: "repeat:changed"; data: { mode: RepeatMode } }
  | { type: "shuffle:changed"; data: { mode: ShuffleMode } };

/** 分页查询队列结果 */
export interface QueuePage {
  /** 当前页的 Track 列表 */
  items: Track[];
  /** 队列总长度 */
  total: number;
  /** 当前播放索引 */
  currentIndex: number;
}

/** 渲染进程调用的播放控制 API */
export interface PlaybackApi {
  /** 设置队列并从指定位置播放 */
  playFrom: (items: Track[], startIndex?: number) => Promise<void>;
  /** 下一首 */
  next: () => Promise<void>;
  /** 上一首 */
  prev: () => Promise<void>;
  /** 设置循环模式 */
  setRepeatMode: (mode: RepeatMode) => Promise<void>;
  /** 设置随机模式 */
  setShuffleMode: (mode: ShuffleMode) => Promise<void>;
  /** 分页获取队列 */
  getQueuePage: (offset: number, limit: number) => Promise<QueuePage>;
  /** 获取队列长度 */
  getQueueLength: () => Promise<number>;
  /** 插入到队列 */
  insert: (item: Track, afterIndex?: number) => Promise<void>;
  /** 从队列移除 */
  remove: (index: number) => Promise<void>;
  /** 移动队列项 */
  move: (fromIndex: number, toIndex: number) => Promise<void>;
  /** 清空队列 */
  clear: () => Promise<void>;
  /** 订阅播放控制事件 */
  onEvent: (callback: (event: PlaybackEvent) => void) => () => void;
}
