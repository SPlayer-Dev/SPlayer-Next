<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import { useNowPlayingSync } from "../desktop-lyric/composables/useNowPlayingSync";
import { useDragWindow } from "./composables/useDragWindow";

const config = reactive<DynamicIslandSettings>({
  height: 40,
  fontWeight: 500,
  wordByWord: true,
  playedColor: "#ffffff",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  alwaysOnTop: true,
});

/**
 * 内部布局纯 flex + gap：整体只控制左右内边距和封面/歌词间距
 * 上下由 align-items: center 自动居中，不需要纵向 padding
 */
const { height: winHeight } = useWindowSize();
const padX = computed(() => Math.round(winHeight.value * 0.4));
const gap = computed(() => Math.round(winHeight.value * 0.25));
const coverSize = computed(() => Math.round(winHeight.value * 0.65));
const coverRadius = computed(() => Math.max(4, Math.round(coverSize.value * 0.3)));
const fontSize = computed(() => Math.max(13, Math.round(winHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(winHeight.value * 0.6));

const { track, lyric, primaryIndex } = useNowPlayingSync();
const { onRootPointerDown } = useDragWindow();

/** 吸附模式 */
const mode = ref<"snapped" | "floating">("snapped");

/** 艺术家显示文本 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/** 当前行；为空时走 fallback */
const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

/** 占位：无当前歌词时显示 "歌曲名 - 歌手" */
const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "SPlayer";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

const rootStyle = computed(() => ({
  "--di-played": config.playedColor,
  "--di-unplayed": config.unplayedColor,
  "--di-bg": config.backgroundColor,
  "--di-padx": `${padX.value}px`,
  "--di-gap": `${gap.value}px`,
  "--di-cover": `${coverSize.value}px`,
  "--di-cover-radius": `${coverRadius.value}px`,
  "--di-snap-radius": `${snapRadius.value}px`,
}));

let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;

onMounted(async () => {
  try {
    const saved = (await window.api.config.get("dynamicIsland")) as DynamicIslandSettings;
    Object.assign(config, saved);
  } catch (error) {
    console.error("[dynamic-island] load config failed", error);
  }
  unsubConfig = window.api.dynamicIsland.onConfigChange((next) =>
    Object.assign(config, next as DynamicIslandSettings),
  );
  unsubMode = window.api.dynamicIsland.onModeChange((next) => {
    mode.value = next;
  });
});

onBeforeUnmount(() => {
  unsubConfig?.();
  unsubConfig = null;
  unsubMode?.();
  unsubMode = null;
});
</script>

<template>
  <div
    class="root"
    :class="mode === 'snapped' ? 'is-snapped' : 'is-floating'"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <div class="cover">
      <img v-if="track?.cover" :src="track.cover" alt="cover" draggable="false" />
      <div v-else class="cover-fallback" />
    </div>
    <div class="lyric">
      <Transition name="di-swap" mode="out-in">
        <IslandLyricLine
          v-if="currentLine"
          :key="primaryIndex"
          :line="currentLine"
          :font-size="fontSize"
          :font-weight="config.fontWeight"
          :word-by-word="config.wordByWord"
        />
        <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
          {{ fallbackText }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.root {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  padding: 0 var(--di-padx);
  box-sizing: border-box;
  background: var(--di-bg);
  cursor: move;
  color: var(--di-played);
  transition: border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* 吸附：仅底部圆角，顶部与屏幕边缘齐平 */
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
/* 自由浮动：胶囊 */
.root.is-floating {
  border-radius: 999px;
}
.cover {
  flex: 0 0 auto;
  width: var(--di-cover);
  height: var(--di-cover);
  border-radius: var(--di-cover-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}
.cover-fallback {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04));
}
.lyric {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  text-align: center;
}
.fallback {
  width: 100%;
  color: var(--di-played);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
/* 歌词/占位切换时的简单淡入淡出 */
.di-swap-enter-active,
.di-swap-leave-active {
  transition: opacity 0.18s ease;
}
.di-swap-enter-from,
.di-swap-leave-to {
  opacity: 0;
}
</style>
