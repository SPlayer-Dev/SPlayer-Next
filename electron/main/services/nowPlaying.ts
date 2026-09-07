import { EventEmitter } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type { Track, PlayerState } from "@shared/types/player";
import type { LyricLine, LyricData, LyricLoadState } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";

type NowPlayingEvents = {
  /** 歌曲切换 */
  "track-change": [{ track: Track | null; revision: number }];
  /** 当前曲目的延迟元数据更新 */
  "track-update": [{ track: Track; revision: number }];
  /** 歌词内容变化 */
  "lyric-change": [NowPlayingSnapshot];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
  /** 当前曲目歌词偏移变化 */
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
};

/** 当前歌曲轻量信息 */
let currentTrack: Track | null = null;
/** 当前曲目元数据修订号 */
let trackRevision = 0;
/** 当前歌曲的完整解析歌词 */
let currentLyric: LyricLine[] = [];
/** 当前激活的歌词源 */
let currentSource: LyricData = null;
/** 当前歌词加载状态 */
let currentLyricStatus: LyricLoadState = "none";
/** 当前歌词文档修订号 */
let lyricRevision = 0;
/** 最近一次播放位置（毫秒） */
let lastPosition = 0;
/** lastPosition 真实成立的墙钟时刻（Date.now 毫秒），用于补偿其过期时长 */
let lastPositionAt = 0;
/** 当前是否处于播放态 */
let playing = false;
/** 完整播放状态，区分 stopped 与 paused */
let playState: PlayerState = "idle";
/** 当前播放速度倍率（0.5 ~ 2.0） */
let playSpeed = 1.0;
/** 当前曲目对应的歌词偏移（ms，正值为歌词提前） */
let currentLyricOffsetMs = 0;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

/**
 * 偏移存储 key：按（曲目, 歌词源）区分，各来源时间轴独立，在线歌词按平台再分
 * @param trackId - 曲目 ID
 * @param source - 歌词源，null（歌词未加载）时退化为裸 trackId
 */
const offsetKey = (trackId: string, source: LyricData): string => {
  if (!source) return trackId;
  const src =
    source.source === "online" && source.platform ? `online:${source.platform}` : source.source;
  return `${trackId}|${src}`;
};

/**
 * 从存储中读取指定曲目当前歌词源的偏移
 * @param trackId - 曲目 ID
 * @param source - 歌词源
 * @returns 偏移值（毫秒），缺省视为 0
 */
const readOffset = (trackId: string | null | undefined, source: LyricData): number => {
  if (!trackId) return 0;
  return store.get("player.lyricOffsets")?.[offsetKey(trackId, source)] ?? 0;
};

/** 当前生效偏移对应的存储 key，用于检测曲目/歌词源变化 */
let currentOffsetKey = "";

/**
 * 同步当前播放状态
 * @param track - 当前曲目
 * @param lyric - 当前歌词
 * @param source - 当前歌词源
 */
export const update = (
  track: Track | null,
  lyric: LyricLine[],
  source: LyricData,
  lyricStatus: LyricLoadState,
): void => {
  const previousIdentity = currentTrack ? `${currentTrack.source}:${currentTrack.id}` : null;
  const nextIdentity = track ? `${track.source}:${track.id}` : null;
  const trackChanged = previousIdentity !== nextIdentity;
  const trackUpdated = !trackChanged && !isDeepStrictEqual(currentTrack, track);
  currentTrack = track;
  if (trackChanged) {
    trackRevision++;
    // 重置播放进度
    lastPosition = 0;
    lastPositionAt = Date.now();
    emitter.emit("track-change", { track, revision: trackRevision });
  } else if (trackUpdated && track) {
    trackRevision++;
    emitter.emit("track-update", { track, revision: trackRevision });
  }

  const lyricChanged =
    currentLyricStatus !== lyricStatus ||
    !isDeepStrictEqual(currentSource, source) ||
    !isDeepStrictEqual(currentLyric, lyric);
  currentLyric = lyric;
  currentSource = source;
  currentLyricStatus = lyricStatus;
  if (lyricChanged) {
    lyricRevision++;
  }
  // 曲目或歌词源任一变化都重读偏移并广播
  const key = track?.id ? offsetKey(track.id, source) : "";
  if (trackChanged || key !== currentOffsetKey) {
    currentOffsetKey = key;
    currentLyricOffsetMs = readOffset(track?.id, source);
    emitter.emit("lyric-offset-change", {
      trackId: track?.id ?? null,
      offsetMs: currentLyricOffsetMs,
    });
  }
  if (lyricChanged) emitter.emit("lyric-change", snapshot());
};

/**
 * 同步播放位置
 * @param positionMs - 播放位置（毫秒）
 * @param isPlaying - 是否处于播放态
 */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  lastPositionAt = Date.now();
  playing = isPlaying;
  if (isPlaying) playState = "playing";
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt,
  });
};

/**
 * 同步播放状态
 * @param state - 引擎播放状态（idle/loading/playing/paused/stopped）
 */
export const onPlayStateChange = (state: PlayerState): void => {
  playState = state;
  playing = state === "playing";
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state,
    speed: playSpeed,
    // 暂停态接收端不补偿延迟，恢复态不能用陈旧时间戳，故取当前时刻
    sendTimestamp: Date.now(),
  });
};

/**
 * 同步播放速度
 * @param speed - 播放速度倍率（0.5 ~ 2.0）
 *
 * 立即广播一帧 position-sync，让窗口当帧换挡，无需等待下一个 5Hz 周期
 */
export const onSpeedChange = (speed: number): void => {
  playSpeed = Number.isFinite(speed) ? speed : 1.0;
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt || Date.now(),
  });
};

/**
 * 单曲偏移的合理上限（毫秒）
 * 超过视为误输入，clamp 防止极端值
 */
const LYRIC_OFFSET_LIMIT_MS = 60_000;

/**
 * 写入指定曲目的歌词偏移；0 视为清除
 * 偏移跟随当前歌词源，持久化到 store 并在影响当前曲目时广播
 * @param trackId - 目标 Track.id
 * @param offsetMs - 偏移值（毫秒），自动 clamp 到 ±60s
 */
export const setLyricOffset = (trackId: string, offsetMs: number): void => {
  if (!trackId) return;
  // IPC 进来可能是 NaN/Infinity，会污染所有下游时间叠加计算，统一视为清除
  const normalized = Number.isFinite(offsetMs) ? Math.trunc(offsetMs) : 0;
  const value = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, normalized));
  const key = offsetKey(trackId, currentSource);
  const map = { ...(store.get("player.lyricOffsets") ?? {}) };
  if (value === 0) delete map[key];
  else map[key] = value;
  store.set("player.lyricOffsets", map);
  // 影响当前曲目则更新运行时缓存并广播
  if (currentTrack && currentTrack.id === trackId) {
    currentLyricOffsetMs = value;
    emitter.emit("lyric-offset-change", { trackId, offsetMs: value });
  }
};

/** 拉取当前完整状态 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  trackRevision,
  lyric: currentLyric,
  source: currentSource,
  lyricStatus: currentLyricStatus,
  lyricRevision,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  // 用 position 的成立时刻，接收端据此补偿其过期时长
  sendTimestamp: lastPositionAt || Date.now(),
});

/** 获取不含完整歌词正文的轻量播放快照 */
export const lightSnapshot = () => ({
  track: currentTrack,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  lyricAvailable: currentLyric.length > 0,
  lyricLineCount: currentLyric.length,
  sendTimestamp: lastPositionAt || Date.now(),
});

/** 获取当前曲目的完整歌词快照 */
export const lyricSnapshot = () => ({
  trackId: currentTrack?.id ?? null,
  lyric: currentLyric,
  source: currentSource,
  lyricOffsetMs: currentLyricOffsetMs,
});

/** 清空 */
export const clear = (): void => {
  update(null, [], null, "none");
};

/** 订阅歌曲切换 */
export const onTrackChange = (
  listener: (data: { track: Track | null; revision: number }) => void,
): (() => void) => {
  emitter.on("track-change", listener);
  return () => emitter.off("track-change", listener);
};

/** 订阅当前曲目的延迟元数据更新 */
export const onTrackUpdate = (
  listener: (data: { track: Track; revision: number }) => void,
): (() => void) => {
  emitter.on("track-update", listener);
  return () => emitter.off("track-update", listener);
};

/** 订阅歌词内容变化 */
export const onLyricChange = (listener: (snap: NowPlayingSnapshot) => void): (() => void) => {
  emitter.on("lyric-change", listener);
  return () => emitter.off("lyric-change", listener);
};

/** 订阅播放位置锚点 */
export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): (() => void) => {
  emitter.on("position-sync", listener);
  return () => emitter.off("position-sync", listener);
};

/** 订阅当前曲目歌词偏移变化 */
export const onLyricOffsetChange = (
  listener: (data: NowPlayingLyricOffsetSync) => void,
): (() => void) => {
  emitter.on("lyric-offset-change", listener);
  return () => emitter.off("lyric-offset-change", listener);
};
