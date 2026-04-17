<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { Track } from "@shared/types/player";
import { clampLastLineEnd, pickPrimaryIndex } from "@shared/utils/lyricSync";

/** 同步偏差阈值 */
const SYNC_DRIFT_THRESHOLD = 300;

/** 非响应式播放时间（供模板读取） */
let currentMs = 0;

const track = shallowRef<Track | null>(null);
const lyric = shallowRef<LyricLine[]>([]);
const playing = ref(false);
const primaryIndex = ref(-1);
/** 锚定方向：内容对齐依据 */
const anchor = ref<"left" | "right">("left");

let anchorPos = 0;
let anchorPerf = 0;
let anchorInitialized = false;
let rafId: number | null = null;

const resetAnchor = (positionMs: number, sendTimestamp: number): void => {
  const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
  anchorPos = positionMs + (playing.value ? ipcDelay : 0);
  anchorPerf = performance.now();
  currentMs = anchorPos;
  anchorInitialized = true;
};

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
  currentMs = next;
  const idx = pickPrimaryIndex(lyric.value, next);
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

/** 当前显示的歌词文本 */
const displayText = computed(() => {
  const lines = lyric.value;
  const idx = primaryIndex.value;
  if (!track.value) return "SPlayer Taskbar Lyric";
  if (lines.length === 0) return track.value.title;
  if (idx < 0 || idx >= lines.length) return track.value.title;
  const words = lines[idx].words;
  return words.map((w) => w.word).join("");
});

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const snap = await window.api.nowPlaying.requestSnapshot();
    applySnapshot(snap);
  } catch {
    // 首次启动时可能尚未有播放数据
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
    window.api.taskbarLyric.onLayout((data) => {
      anchor.value = data.anchor;
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
</script>

<template>
  <div class="taskbar-lyric" :class="anchor === 'right' ? 'align-right' : 'align-left'">
    <span class="lyric-text">{{ displayText }}</span>
  </div>
</template>

<style>
.taskbar-lyric {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: 0 8px;
  overflow: hidden;
  white-space: nowrap;
  background: rgba(255, 0, 0, 0.3);
  border: 1px solid rgba(255, 0, 0, 0.6);
  box-sizing: border-box;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.taskbar-lyric:hover {
  background: rgba(0, 120, 255, 0.35);
  border-color: rgba(0, 120, 255, 0.7);
}

.taskbar-lyric.align-left {
  justify-content: flex-start;
}

.taskbar-lyric.align-right {
  justify-content: flex-end;
}

.lyric-text {
  font-size: 12px;
  font-weight: 400;
  color: #fff;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
