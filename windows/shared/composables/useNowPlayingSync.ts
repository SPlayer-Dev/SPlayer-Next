import type { Ref, ShallowRef } from "vue";
import type { LyricLine } from "@shared/types/lyrics";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { Track } from "@shared/types/player";
import { clampLastLineEnd } from "@shared/utils/lyricSync";

/** 同步偏差阈值 */
const SYNC_DRIFT_THRESHOLD = 300;

/** 提供给逐字高亮的非响应式当前播放时间 */
let currentNowPlayingMs = 0;

export const getNowPlayingCurrentMs = (): number => currentNowPlayingMs;

export interface NowPlayingSyncOptions {
  /** 选择当前主行索引的算法 */
  pickIndex: (lyric: LyricLine[], time: number) => number;
  /** 日志 / 错误前缀 */
  logTag: string;
}

export interface NowPlayingSync {
  track: ShallowRef<Track | null>;
  lyric: ShallowRef<LyricLine[]>;
  playing: Ref<boolean>;
  primaryIndex: Ref<number>;
}

/**
 * 播放状态同步
 * 拉取 / 订阅快照、维护播放锚点、RAF 高频更新 currentMs 与 primaryIndex
 */
export const useNowPlayingSync = (options: NowPlayingSyncOptions): NowPlayingSync => {
  const { pickIndex, logTag } = options;

  const track = shallowRef<Track | null>(null);
  const lyric = shallowRef<LyricLine[]>([]);
  const playing = ref(false);
  const primaryIndex = ref(-1);

  let anchorPos = 0;
  let anchorPerf = 0;
  let anchorInitialized = false;
  let rafId: number | null = null;

  const resetAnchor = (positionMs: number, sendTimestamp: number): void => {
    const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
    anchorPos = positionMs + (playing.value ? ipcDelay : 0);
    anchorPerf = performance.now();
    currentNowPlayingMs = anchorPos;
    anchorInitialized = true;
  };

  // 仅当与 RAF 插值的偏差超过阈值时才重置锚点，避免每次 5Hz 同步都打断动画
  const applyAnchor = (positionMs: number, sendTimestamp: number): void => {
    if (!anchorInitialized || !playing.value) {
      resetAnchor(positionMs, sendTimestamp);
      return;
    }
    const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
    const candidate = positionMs + ipcDelay;
    const projected = anchorPos + (performance.now() - anchorPerf);
    if (Math.abs(candidate - projected) > SYNC_DRIFT_THRESHOLD) {
      resetAnchor(positionMs, sendTimestamp);
    }
  };

  const applySnapshot = (snap: NowPlayingSnapshot): void => {
    track.value = snap.track;
    const mainLines = snap.lyric.filter((line) => !line.isBG);
    lyric.value = clampLastLineEnd(mainLines, snap.track?.duration);
    playing.value = snap.playing;
    primaryIndex.value = -1;
    resetAnchor(snap.position, snap.sendTimestamp);
  };

  const syncOnce = (): void => {
    const next = playing.value ? anchorPos + (performance.now() - anchorPerf) : anchorPos;
    currentNowPlayingMs = next;
    const idx = pickIndex(lyric.value, next);
    if (idx !== primaryIndex.value) primaryIndex.value = idx;
  };

  const tick = (): void => {
    syncOnce();
    rafId = playing.value ? requestAnimationFrame(tick) : null;
  };

  const kickTick = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  };

  const unsubscribers: Array<() => void> = [];

  onMounted(async () => {
    try {
      const snap = await window.api.nowPlaying.requestSnapshot();
      applySnapshot(snap);
    } catch (error) {
      console.error(`[${logTag}] requestSnapshot failed`, error);
    }

    unsubscribers.push(
      window.api.nowPlaying.onLyricChange((snap) => {
        applySnapshot(snap);
        kickTick();
      }),
      window.api.nowPlaying.onPositionSync((data) => {
        playing.value = data.playing;
        applyAnchor(data.position, data.sendTimestamp);
        kickTick();
      }),
    );

    kickTick();
  });

  onBeforeUnmount(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const off of unsubscribers) off();
  });

  return { track, lyric, playing, primaryIndex };
};
