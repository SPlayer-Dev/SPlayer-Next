/**
 * 订阅播放事件的插件的播放事件桥
 */

import type { Track, PlayerState } from "@shared/types/player";
import type { LyricLine } from "lyric-kit";

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

const onTrackChange = (data: { track: Track | null }): void => {
  lyricLines = [];
  currentIndex = -1;
  pluginRegistry.broadcastPlaybackEvent("trackChange", { track: data.track });
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
  pluginRegistry.broadcastPlaybackEvent("lyricChange", { lines: lyricLines });
  reEmitLine(snap.position);
};

const onLyricOffsetChange = (data: NowPlayingLyricOffsetSync): void => {
  lyricOffsetMs = data.offsetMs;
  reEmitLine(nowPlaying.snapshot().position);
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

/** 给单个刚就绪的订阅播放事件的插件定向补发当前播放快照 */
const primePlugin = (id: string): void => {
  const snap = nowPlaying.snapshot();
  const send = <K extends PlaybackEventKind>(event: K, data: PlaybackEventData[K]): void =>
    pluginRegistry.sendPlaybackEventTo(id, event, data);
  send("trackChange", { track: snap.track });
  send("lyricChange", { lines: snap.lyric });
  send("playStateChange", { state: toPluginState(snap.state), position: snap.position });
  const index = snap.lyric.length > 0 ? findIndex(snap.position + snap.lyricOffsetMs) : -1;
  if (index >= 0) send("lineChange", { index, position: snap.position });
};

/** 挂载所有 nowPlaying 订阅 */
const attach = (): void => {
  if (unsubscribers.length > 0) return;
  unsubscribers = [
    nowPlaying.onTrackChange(onTrackChange),
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

/**
 * 按播放事件订阅情况挂载桥接，并向就绪插件补发快照
 */
export const init = (): void => {
  if (pluginRegistry.hasPlaybackSubscribers()) attach();
  /**
   * 随订阅者有无切换事件桥接
   * @param active - 是否存在就绪的播放事件订阅者
   */
  const onPlaybackActivity = (active: boolean): void => (active ? attach() : detach());
  /**
   * 向刚就绪的订阅者补发播放快照
   * @param id - 插件标识
   */
  const onSubscriberReady = (id: string): void => primePlugin(id);
  pluginRegistry.on("playbackActivityChange", onPlaybackActivity);
  pluginRegistry.on("playbackSubscriberReady", onSubscriberReady);
  offRegistryEvents = () => {
    pluginRegistry.off("playbackActivityChange", onPlaybackActivity);
    pluginRegistry.off("playbackSubscriberReady", onSubscriberReady);
  };
};

/** 关闭 */
export const dispose = (): void => {
  offRegistryEvents?.();
  offRegistryEvents = null;
  detach();
};
