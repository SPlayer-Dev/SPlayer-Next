<script setup lang="ts">
import { findLyricIndex, findActiveLyricIndices } from "@shared/utils/lyric";
import type { NowPlayingSnapshot, NowPlayingPositionSync } from "@shared/types/nowPlaying";
import type { LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import type { DesktopLyricAlign, DesktopLyricSettings } from "@shared/types/settings";
import LyricLineView from "./components/LyricLine.vue";

const config = reactive<DesktopLyricSettings>({
  fontSize: 24,
  fontWeight: 600,
  showTranslation: true,
  doubleLine: true,
  align: "center",
  wordByWord: true,
  playedColor: "#ffffff",
  unplayedColor: "#7d7d7d",
  translationColor: "#b3b3b3",
  alwaysOnTop: true,
  locked: false,
});

const track = shallowRef<Track | null>(null);
const lyric = shallowRef<LyricLine[]>([]);
const playing = ref(false);
const currentMs = ref(0);
const primaryIndex = ref(-1);
const activeIndices = shallowRef<number[]>([]);

let anchorPos = 0;
let anchorPerf = 0;

interface DisplayItem {
  key: string;
  index: number;
  line: LyricLine;
  align: DesktopLyricAlign;
}

/** 两端对齐：按行 index 奇偶切左右，其他对齐沿用 config.align */
const resolveAlign = (index: number): DesktopLyricAlign => {
  if (config.align !== "justify") return config.align;
  return index % 2 === 0 ? "left" : "right";
};

const displayItems = computed<DisplayItem[]>(() => {
  const lines = lyric.value;
  if (lines.length === 0) return [];

  const items: DisplayItem[] = [];
  const active = activeIndices.value;

  if (active.length > 0) {
    for (const idx of active) {
      items.push({ key: `a-${idx}`, index: idx, line: lines[idx], align: resolveAlign(idx) });
    }
    if (config.doubleLine) {
      const nextIdx = active[active.length - 1] + 1;
      if (nextIdx < lines.length) {
        items.push({
          key: `n-${nextIdx}`,
          index: nextIdx,
          line: lines[nextIdx],
          align: resolveAlign(nextIdx),
        });
      }
    }
    return items;
  }

  const primary = primaryIndex.value;
  if (primary >= 0) {
    items.push({
      key: `g-${primary}`,
      index: primary,
      line: lines[primary],
      align: resolveAlign(primary),
    });
  }
  if (config.doubleLine) {
    const nextIdx = primary + 1;
    if (nextIdx > 0 && nextIdx < lines.length) {
      items.push({
        key: `gn-${nextIdx}`,
        index: nextIdx,
        line: lines[nextIdx],
        align: resolveAlign(nextIdx),
      });
    }
  }
  return items;
});

const displayTitle = computed<string>(() => {
  const cur = track.value;
  if (!cur) return "暂无播放";
  const artist = cur.artists?.map((a) => a.name).join(" / ") ?? "";
  return artist ? `${cur.title} - ${artist}` : cur.title;
});

const rootStyle = computed(() => ({
  "--dl-played": config.playedColor,
  "--dl-unplayed": config.unplayedColor,
  "--dl-trans": config.translationColor,
}));

const applyAnchor = (positionMs: number, sendTimestamp: number): void => {
  const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
  anchorPos = positionMs + ipcDelay;
  anchorPerf = performance.now();
};

const applySnapshot = (snap: NowPlayingSnapshot): void => {
  track.value = snap.track;
  lyric.value = snap.lyric;
  playing.value = snap.playing;
  primaryIndex.value = -1;
  activeIndices.value = [];
  applyAnchor(snap.position, snap.sendTimestamp);
};

let rafId: number | null = null;
const tick = (): void => {
  if (playing.value) {
    currentMs.value = anchorPos + (performance.now() - anchorPerf);
  } else {
    currentMs.value = anchorPos;
  }
  primaryIndex.value = findLyricIndex(lyric.value, currentMs.value, primaryIndex.value);
  activeIndices.value = findActiveLyricIndices(lyric.value, currentMs.value);
  rafId = requestAnimationFrame(tick);
};

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const saved = await window.api.config.get("desktopLyric");
    Object.assign(config, saved as DesktopLyricSettings);
  } catch (error) {
    console.error("[desktop-lyric] load config failed", error);
  }

  try {
    const snap = await window.api.nowPlaying.requestSnapshot();
    applySnapshot(snap);
  } catch (error) {
    console.error("[desktop-lyric] requestSnapshot failed", error);
  }

  unsubscribers.push(
    window.api.desktopLyric.onConfigChange((next) => Object.assign(config, next)),
    window.api.nowPlaying.onLyricChange((snap) => applySnapshot(snap)),
    window.api.nowPlaying.onPositionSync((data: NowPlayingPositionSync) => {
      playing.value = data.playing;
      applyAnchor(data.position, data.sendTimestamp);
    }),
  );

  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div class="root" :style="rootStyle">
    <div class="title">{{ displayTitle }}</div>
    <TransitionGroup tag="div" name="dl-line" class="stage">
      <LyricLineView
        v-for="item in displayItems"
        :key="item.key"
        :line="item.line"
        :current-ms="currentMs"
        :font-size="config.fontSize"
        :font-weight="config.fontWeight"
        :align="item.align"
        :word-by-word="config.wordByWord"
        :show-translation="config.showTranslation"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped src="./App.css" />
