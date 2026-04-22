import { EventEmitter } from "node:events";
import type { Track } from "@shared/types/player";
import type { LyricLine, LyricData } from "@shared/types/lyrics";
import type { NowPlayingSnapshot, NowPlayingPositionSync } from "@shared/types/nowPlaying";

type NowPlayingEvents = {
  /** 歌曲切换 */
  "track-change": [{ track: Track | null }];
  /** 歌词内容变化 */
  "lyric-change": [NowPlayingSnapshot];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
};

/** 当前歌曲轻量信息 */
let currentTrack: Track | null = null;
/** 当前歌曲的完整解析歌词 */
let currentLyric: LyricLine[] = [];
/** 当前激活的歌词源 */
let currentSource: LyricData = null;
/** 最近一次播放位置（毫秒） */
let lastPosition = 0;
/** 当前是否处于播放态 */
let playing = false;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

/** 渲染进程同步当前播放状态 */
export const update = (track: Track | null, lyric: LyricLine[], source: LyricData): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentLyric = lyric;
  currentSource = source;
  if (trackChanged) emitter.emit("track-change", { track });
  emitter.emit("lyric-change", snapshot());
};

/** 主进程 position 事件入口（原生 5Hz） */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  playing = isPlaying;
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    sendTimestamp: Date.now(),
  });
};

/** 播放状态变化时立即同步一次 */
export const onPlayStateChange = (isPlaying: boolean): void => {
  playing = isPlaying;
  emitter.emit("position-sync", {
    position: lastPosition,
    playing: isPlaying,
    sendTimestamp: Date.now(),
  });
};

/** 窗口启动对齐：拉取当前完整状态 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  lyric: currentLyric,
  source: currentSource,
  position: lastPosition,
  playing,
  sendTimestamp: Date.now(),
});

/** 清空 */
export const clear = (): void => {
  currentTrack = null;
  currentLyric = [];
  currentSource = null;
  emitter.emit("lyric-change", snapshot());
};

/** 订阅歌曲切换 */
export const onTrackChange = (listener: (data: { track: Track | null }) => void): void => {
  emitter.on("track-change", listener);
};

/** 订阅歌词内容变化 */
export const onLyricChange = (listener: (snap: NowPlayingSnapshot) => void): void => {
  emitter.on("lyric-change", listener);
};

/** 订阅播放位置锚点 */
export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): void => {
  emitter.on("position-sync", listener);
};
