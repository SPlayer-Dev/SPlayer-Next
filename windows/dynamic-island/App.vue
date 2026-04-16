<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import { useNowPlayingSync } from "./composables/useNowPlayingSync";
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

// 基于权威高度配置计算所有几何尺寸（避免 useWindowSize 的初始值为 Infinity 的问题）
const padX = computed(() => Math.round(config.height * 0.4));
const gap = computed(() => Math.round(config.height * 0.25));
const coverSize = computed(() => Math.round(config.height * 0.65));
const coverRadius = computed(() => Math.max(4, Math.round(coverSize.value * 0.3)));
const fontSize = computed(() => Math.max(13, Math.round(config.height * 0.5)));
const snapRadius = computed(() => Math.round(config.height * 0.6));

const { track, lyric, primaryIndex } = useNowPlayingSync();
const { onRootPointerDown } = useDragWindow();

/** 吸附模式 */
const mode = ref<"snapped" | "floating">("snapped");

// ─── 文本测量 ───
const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string): number => {
  const family = getComputedStyle(document.documentElement).fontFamily;
  measureCtx.font = `${config.fontWeight} ${fontSize.value}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
};

/** 艺术家显示文本 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/** 数据层：当前播放对应的歌词行 */
const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

/** 占位文本 */
const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "SPlayer";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

// ─── 两阶段宽度动画 ───
// 实际显示的内容（在 width=0 时静默替换）
const displayLine = shallowRef<LyricLine | null>(null);
const displayFallback = ref("SPlayer");
const displayIndex = ref(-1);

/**
 * 回弹 easing 的最大过冲比例
 * cubic-bezier(0.34, 1.56, 0.64, 1) 峰值约 1.09
 */
const BOUNCE_OVERSHOOT = 0.1;

/** 歌词区域宽度，CSS transition 驱动动画 */
const lyricWidth = ref(0);
/** 歌词区域透明度 */
const lyricOpacity = ref(1);
/** 是否正在收缩（驱动收缩 CSS transition） */
const shrinking = ref(false);
/** 动画阶段 */
let phase: "idle" | "shrinking" | "expanding" = "idle";

/** 拼接行文本 */
const lineText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

/** 计算目标歌词区域宽度 */
const measureTarget = (): number => {
  const line = currentLine.value;
  const text = line ? lineText(line) : fallbackText.value;
  return measureTextWidth(text);
};

/** 计算完整窗口宽度（含回弹余量） */
const computeWindowWidth = (lyricPx: number): number => {
  const bounceExtra = Math.ceil(lyricPx * BOUNCE_OVERSHOOT);
  return padX.value * 2 + coverSize.value + gap.value + lyricPx + bounceExtra;
};

/** 同步窗口宽度 */
const resizeWindow = (lyricPx: number): void => {
  window.api.dynamicIsland.resize(computeWindowWidth(lyricPx));
};

/** 直接设置内容并展开（lyricWidth=0 时的初次/冷启动路径，跳过 shrink） */
const applyImmediate = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  const targetPx = measureTarget();
  shrinking.value = false;
  lyricOpacity.value = 1;
  lyricWidth.value = targetPx;
  resizeWindow(targetPx);
  phase = "expanding";
};

/** 启动缩 → 换 → 展动画 */
const startSwapAnimation = (): void => {
  phase = "shrinking";
  shrinking.value = true;
  lyricWidth.value = 0;
  lyricOpacity.value = 0;
};

/** transitionend 驱动阶段切换 */
const onLyricTransitionEnd = (event: TransitionEvent): void => {
  if (event.propertyName !== "width") return;
  if (phase === "shrinking") {
    // 宽度到 0，静默替换内容
    displayLine.value = currentLine.value;
    displayFallback.value = fallbackText.value;
    displayIndex.value = primaryIndex.value;
    // 测量新内容并 resize 窗口
    const targetPx = measureTarget();
    resizeWindow(targetPx);
    // 下帧开始展开（先切回展开态再设宽度，确保用展开 transition）
    requestAnimationFrame(() => {
      shrinking.value = false;
      phase = "expanding";
      lyricOpacity.value = 1;
      lyricWidth.value = targetPx;
    });
  } else if (phase === "expanding") {
    phase = "idle";
  }
};

/** 监听歌词变化 */
watch([currentLine, fallbackText], () => {
  // 内容实际变化才触发动画
  const newLine = currentLine.value;
  const changed = newLine
    ? displayIndex.value !== primaryIndex.value
    : displayFallback.value !== fallbackText.value;
  if (!changed) return;

  if (phase === "shrinking") {
    // 正在缩，等它结束自然会用最新数据
    return;
  }

  // 当前 lyricWidth 为 0（首次显示或尚未加载）直接展开，不经过 shrink
  if (lyricWidth.value === 0) {
    applyImmediate();
    return;
  }

  startSwapAnimation();
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
    <div
      class="lyric"
      :class="{ 'is-shrinking': shrinking }"
      :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }"
      @transitionend="onLyricTransitionEnd"
    >
      <IslandLyricLine
        v-if="displayLine"
        :key="displayIndex"
        :line="displayLine"
        :font-size="fontSize"
        :font-weight="config.fontWeight"
        :word-by-word="config.wordByWord"
      />
      <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
        {{ displayFallback }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.root {
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  padding: 0 var(--di-padx);
  box-sizing: border-box;
  background: var(--di-bg);
  cursor: move;
  color: var(--di-played);
  width: fit-content;
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
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
  /* 展开：回弹 + 渐显 */
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease-out;
}
/* 收缩：缩进 + 渐隐 */
.lyric.is-shrinking {
  transition:
    width 0.25s ease-in,
    opacity 0.25s ease-in;
}
.fallback {
  color: var(--di-played);
  white-space: nowrap;
}
</style>
