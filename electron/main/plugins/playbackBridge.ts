/**
 * 控制类插件的播放事件桥
 */

import type { Track, PlayerState } from "@shared/types/player";
import type { LyricLine } from "@shared/types/lyrics";
import type { PlaybackEventData, PlaybackEventKind } from "@shared/types/plugin";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import * as nowPlaying from "@main/services/nowPlaying";
import { pluginRegistry } from "./registry";

type PluginPlayState = PlaybackEventData["playStateChange"]["state"];

let lyricLines: LyricLine[] = [];
let currentIndex = -1;
let lyricOffsetMs = 0;
let lastPluginState: PluginPlayState = "paused";
let unsubscribers: Array<() => void> = [];
/** 移除注册表事件监听的句柄 */
let offRegistryEvents: (() => void) | null = null;

/** 引擎播放状态 → 插件可见的三态（idle/loading 视为 paused） */
const toPluginState = (state: PlayerState): PluginPlayState =>
  state === "playing" ? "playing" : state === "stopped" ? "stopped" : "paused";

/** 找 startTime <= time 的最后一行 */
const findIndex = (time: number): number => {
  let result = -1;
  for (let index = 0; index < lyricLines.length; index++) {
    if (lyricLines[index].startTime <= time) result = index;
    else break;
  }
  return result;
};

const onTrackChange = (data: { track: Track | null; revision: number }): void => {
  lyricLines = [];
  currentIndex = -1;
  pluginRegistry.broadcastPlaybackEvent("trackChange", data);
};

/** 转发当前曲目的延迟元数据更新 */
const onTrackUpdate = (data: { track: Track; revision: number }): void => {
  pluginRegistry.broadcastPlaybackEvent("trackUpdate", data);
};

/** 按给定进度重算当前行，与上次不同才补发；暂停态没有后续 position-sync，靠这里纠正 */
const reEmitLine = (position: number): void => {
  const next = lyricLines.length > 0 ? findIndex(position + lyricOffsetMs) : -1;
  if (next === currentIndex) return;
  currentIndex = next;
  pluginRegistry.broadcastPlaybackEvent("lineChange", { index: next, position });
};

const onLyricChange = (snap: NowPlayingSnapshot): void => {
  lyricLines = snap.lyric;
  currentIndex = -1;
  lyricOffsetMs = snap.lyricOffsetMs;
  pluginRegistry.broadcastPlaybackEvent("lyricChange", {
    lines: lyricLines,
    source: snap.source,
    status: snap.lyricStatus,
    revision: snap.lyricRevision,
  });
  reEmitLine(snap.position);
};

/** 转发供插件本地插值的播放锚点 */
const emitPositionSync = (data: NowPlayingPositionSync): void => {
  pluginRegistry.broadcastPlaybackEvent("positionSync", {
    position: data.position,
    state: toPluginState(data.state),
    speed: data.speed,
    lyricOffsetMs,
    sendTimestamp: data.sendTimestamp,
  });
};

const onLyricOffsetChange = (data: NowPlayingLyricOffsetSync): void => {
  lyricOffsetMs = data.offsetMs;
  const snap = nowPlaying.snapshot();
  reEmitLine(snap.position);
  emitPositionSync({
    position: snap.position,
    playing: snap.playing,
    state: snap.state,
    speed: snap.speed,
    sendTimestamp: snap.sendTimestamp,
  });
};

const onPositionSync = (data: NowPlayingPositionSync): void => {
  const pluginState = toPluginState(data.state);
  if (pluginState !== lastPluginState) {
    lastPluginState = pluginState;
    pluginRegistry.broadcastPlaybackEvent("playStateChange", {
      state: pluginState,
      position: data.position,
    });
  }
  emitPositionSync(data);
  if (lyricLines.length === 0) return;
  const next = findIndex(data.position + lyricOffsetMs);
  if (next === currentIndex) return;
  currentIndex = next;
  pluginRegistry.broadcastPlaybackEvent("lineChange", { index: next, position: data.position });
};

/** 挂载时把当前快照灌入本桥内部状态 */
const primeState = (): void => {
  const snap = nowPlaying.snapshot();
  lyricLines = snap.lyric;
  lyricOffsetMs = snap.lyricOffsetMs;
  lastPluginState = toPluginState(snap.state);
  currentIndex = lyricLines.length > 0 ? findIndex(snap.position + lyricOffsetMs) : -1;
};

/** 给单个刚就绪的控制类插件定向补发当前播放快照 */
const primePlugin = (id: string): void => {
  const snap = nowPlaying.snapshot();
  const send = <K extends PlaybackEventKind>(event: K, data: PlaybackEventData[K]): void =>
    pluginRegistry.sendPlaybackEventTo(id, event, data);
  send("trackChange", { track: snap.track, revision: snap.trackRevision });
  send("lyricChange", {
    lines: snap.lyric,
    source: snap.source,
    status: snap.lyricStatus,
    revision: snap.lyricRevision,
  });
  send("playStateChange", { state: toPluginState(snap.state), position: snap.position });
  send("positionSync", {
    position: snap.position,
    state: toPluginState(snap.state),
    speed: snap.speed,
    lyricOffsetMs: snap.lyricOffsetMs,
    sendTimestamp: snap.sendTimestamp,
  });
  const index = snap.lyric.length > 0 ? findIndex(snap.position + snap.lyricOffsetMs) : -1;
  if (index >= 0) send("lineChange", { index, position: snap.position });
};

/** 挂载所有 nowPlaying 订阅 */
const attach = (): void => {
  if (unsubscribers.length > 0) return;
  unsubscribers = [
    nowPlaying.onTrackChange(onTrackChange),
    nowPlaying.onTrackUpdate(onTrackUpdate),
    nowPlaying.onLyricChange(onLyricChange),
    nowPlaying.onLyricOffsetChange(onLyricOffsetChange),
    nowPlaying.onPositionSync(onPositionSync),
  ];
  primeState();
};

/** 卸载订阅并清空状态 */
const detach = (): void => {
  for (const unsub of unsubscribers) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  unsubscribers = [];
  lyricLines = [];
  currentIndex = -1;
  lyricOffsetMs = 0;
  lastPluginState = "paused";
};

/** 启动：按当前是否有控制类插件惰性挂载，并随其增减切换；每个插件就绪时定向补发快照 */
export const init = (): void => {
  if (pluginRegistry.hasEnabledControlPlugin()) attach();
  const onControlActivity = (active: boolean): void => (active ? attach() : detach());
  const onControlReady = (id: string): void => primePlugin(id);
  pluginRegistry.on("controlActivityChange", onControlActivity);
  pluginRegistry.on("controlPluginReady", onControlReady);
  offRegistryEvents = () => {
    pluginRegistry.off("controlActivityChange", onControlActivity);
    pluginRegistry.off("controlPluginReady", onControlReady);
  };
};

/** 关闭 */
export const dispose = (): void => {
  offRegistryEvents?.();
  offRegistryEvents = null;
  detach();
};
