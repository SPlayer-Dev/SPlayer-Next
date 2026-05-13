import { EventEmitter } from "node:events";
import type { Track } from "@shared/types/player";
import type { LyricLine, LyricData } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";

type NowPlayingEvents = {
  /** 歌曲切换 */
  "track-change": [{ track: Track | null }];
  /** 歌词内容变化 */
  "lyric-change": [NowPlayingSnapshot];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
  /** 当前曲目歌词偏移变化 */
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
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
/** 当前曲目对应的歌词偏移（ms，正值为歌词提前） */
let currentLyricOffsetMs = 0;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

/** 从存储中读取指定曲目的偏移；缺省视为 0 */
const readOffset = (trackId: string | null | undefined): number => {
  if (!trackId) return 0;
  return store.get("player.lyricOffsets")?.[trackId] ?? 0;
};

/** 渲染进程同步当前播放状态 */
export const update = (track: Track | null, lyric: LyricLine[], source: LyricData): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentLyric = lyric;
  currentSource = source;
  if (trackChanged) {
    // 切歌：加载新曲目的偏移并立即广播
    currentLyricOffsetMs = readOffset(track?.id);
    emitter.emit("track-change", { track });
    emitter.emit("lyric-offset-change", {
      trackId: track?.id ?? null,
      offsetMs: currentLyricOffsetMs,
    });
  }
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

/** 单曲偏移的合理上限（毫秒）；超过视为误输入，clamp 防止极端值 */
const LYRIC_OFFSET_LIMIT_MS = 60_000;

/**
 * 写入指定曲目的歌词偏移；0 视为清除
 * 同时持久化到 store，并在影响当前曲目时广播
 * @param trackId - 目标 Track.id
 * @param offsetMs - 偏移值（毫秒），自动 clamp 到 ±60s
 */
export const setLyricOffset = (trackId: string, offsetMs: number): void => {
  if (!trackId) return;
  // IPC 进来可能是 NaN/Infinity，会污染所有下游时间叠加计算，统一视为清除
  const normalized = Number.isFinite(offsetMs) ? Math.trunc(offsetMs) : 0;
  const value = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, normalized));
  const map = { ...(store.get("player.lyricOffsets") ?? {}) };
  if (value === 0) delete map[trackId];
  else map[trackId] = value;
  store.set("player.lyricOffsets", map);
  // 影响当前曲目则更新运行时缓存并广播
  if (currentTrack && currentTrack.id === trackId) {
    currentLyricOffsetMs = value;
    emitter.emit("lyric-offset-change", { trackId, offsetMs: value });
  }
};

/** 窗口启动对齐：拉取当前完整状态 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  lyric: currentLyric,
  source: currentSource,
  position: lastPosition,
  playing,
  lyricOffsetMs: currentLyricOffsetMs,
  sendTimestamp: Date.now(),
});

/** 清空 */
export const clear = (): void => {
  currentTrack = null;
  currentLyric = [];
  currentSource = null;
  currentLyricOffsetMs = 0;
  emitter.emit("lyric-change", snapshot());
  emitter.emit("lyric-offset-change", { trackId: null, offsetMs: 0 });
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

/** 订阅当前曲目歌词偏移变化 */
export const onLyricOffsetChange = (listener: (data: NowPlayingLyricOffsetSync) => void): void => {
  emitter.on("lyric-offset-change", listener);
};
