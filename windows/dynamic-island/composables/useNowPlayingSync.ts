import type { Ref, ShallowRef } from "vue";
import type { LyricLine } from "@shared/types/lyrics";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { Track } from "@shared/types/player";
import { clampLastLineEnd, pickPrimaryIndex } from "@shared/utils/lyricSync";

/** 同步偏差阈值 */
const SYNC_DRIFT_THRESHOLD = 300;

/** 提供给逐字高亮的非响应式当前播放时间 */
let currentNowPlayingMs = 0;

export const getNowPlayingCurrentMs = (): number => currentNowPlayingMs;

/**
 * 播放状态同步
 * 拉取 / 订阅快照、维护播放锚点、RAF 高频更新 currentMs 与 primaryIndex
 */
export const useNowPlayingSync = (): {
  track: ShallowRef<Track | null>;
  lyric: ShallowRef<LyricLine[]>;
  playing: Ref<boolean>;
  primaryIndex: Ref<number>;
} => {
  /** 当前播放的曲目 */
  const track = shallowRef<Track | null>(null);
  /** 当前歌词数组 */
  const lyric = shallowRef<LyricLine[]>([]);
  /** 是否正在播放 */
  const playing = ref(false);
  /** 当前行索引 */
  const primaryIndex = ref(-1);

  /** 锚点播放位置 */
  let anchorPos = 0;
  /** 锚点对应的 performance.now 时刻 */
  let anchorPerf = 0;
  /** 锚点是否已初始化 */
  let anchorInitialized = false;
  /** 帧同步 ID */
  let rafId: number | null = null;

  /** 重置锚点 */
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

  /** 应用快照 */
  const applySnapshot = (snap: NowPlayingSnapshot): void => {
    track.value = snap.track;
    const mainLines = snap.lyric.filter((line) => !line.isBG);
    lyric.value = clampLastLineEnd(mainLines, snap.track?.duration);
    playing.value = snap.playing;
    primaryIndex.value = -1;
    resetAnchor(snap.position, snap.sendTimestamp);
  };

  /** 一次同步 */
  const syncOnce = (): void => {
    const next = playing.value ? anchorPos + (performance.now() - anchorPerf) : anchorPos;
    currentNowPlayingMs = next;
    const idx = pickPrimaryIndex(lyric.value, next);
    if (idx !== primaryIndex.value) primaryIndex.value = idx;
  };

  /** 帧同步 */
  const tick = (): void => {
    syncOnce();
    rafId = playing.value ? requestAnimationFrame(tick) : null;
  };

  /** 触发一帧同步 */
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
      console.error("[dynamic-island] requestSnapshot failed", error);
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
