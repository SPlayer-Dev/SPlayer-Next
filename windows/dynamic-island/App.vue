<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import { useNowPlayingSync } from "./composables/useNowPlayingSync";
import { useDragWindow } from "./composables/useDragWindow";

const config = reactive<DynamicIslandSettings>({
  scale: 1,
  fontWeight: 500,
  wordByWord: true,
  playedColor: "#ffffff",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  alwaysOnTop: true,
  snapCentered: true,
  nonOcclusive: false,
  doubleLine: false,
  showTranslation: false,
});

/* 悬停隐藏：非遮挡模式下仅在鼠标悬停时透明 */
const hovering = ref(false);

/* 窗口尺寸计算 */
const mainRowHeight = computed(() => Math.round(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale));

/* 主元素尺寸 */
const padX = computed(() => Math.round(mainRowHeight.value * 0.4));
const gap = computed(() => Math.round(mainRowHeight.value * 0.25));
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65));
const coverRadius = computed(() => Math.max(4, Math.round(coverSize.value * 0.3)));
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6));

/* 副行尺寸 */
const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)));
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2));

const { track, lyric, primaryIndex } = useNowPlayingSync();
const { onRootPointerDown } = useDragWindow();

/* 窗口模式 */
const mode = ref<"snapped" | "floating">("snapped");

/* 文本测量 */
const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string, sizePx: number = fontSize.value): number => {
  const family = getComputedStyle(document.documentElement).fontFamily;
  measureCtx.font = `${config.fontWeight} ${sizePx}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
};

/* 艺术家显示文本 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/* 当前行 */
const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

/* 备用文本 */
const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "SPlayer";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

/* 实际显示的内容 */
const displayLine = shallowRef<LyricLine | null>(null);
/* 备用文本 */
const displayFallback = ref("SPlayer");
/* 当前行索引 */
const displayIndex = ref(-1);
/* 副行文本 */
const displaySubText = ref("");

/* 副行是否出现 */
const showSubLine = computed(() => config.doubleLine || displaySubText.value !== "");

/* 窗口高度 */
const windowHeight = computed(
  () => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0),
);

// 回弹 easing cubic-bezier(0.34, 1.56, 0.64, 1) 峰值约 1.10
// 15% 留安全余量避免文本被裁
const BOUNCE_OVERSHOOT = 0.15;

/* 歌词宽度 */
const lyricWidth = ref(measureTextWidth(displayFallback.value));
const lyricOpacity = ref(1);

/* 是否正在收缩 */
const shrinking = ref(false);
/* 窗口阶段 */
let phase: "idle" | "shrinking" | "expanding" = "idle";

/* 是否已经渲染过 */
let hasPainted = false;

/* 行文本 */
const lineText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

/* 计算副行文本 */
const computeSubText = (idx: number, line: LyricLine | null): string => {
  if (config.showTranslation && line?.translatedLyric) return line.translatedLyric;
  if (!config.doubleLine || idx < 0) return "";
  const next = lyric.value[idx + 1];
  return next ? lineText(next) : "";
};

/* 计算目标宽度 */
const measureTarget = (): number => {
  const line = currentLine.value;
  const mainText = line ? lineText(line) : fallbackText.value;
  const mainPx = Math.max(1, measureTextWidth(mainText));
  const subText = computeSubText(primaryIndex.value, line);
  const subPx = subText ? measureTextWidth(subText, subFontSize.value) : 0;
  return Math.max(mainPx, subPx);
};

/* 计算窗口宽度 */
const computeWindowWidth = (lyricPx: number): number => {
  const bounceExtra = Math.ceil(lyricPx * BOUNCE_OVERSHOOT);
  return padX.value * 2 + coverSize.value + gap.value + lyricPx + bounceExtra;
};

/* 调整窗口宽度 */
const resizeWindow = (lyricPx: number): void => {
  window.api.dynamicIsland.resize(computeWindowWidth(lyricPx));
};

/* 立即应用 */
const applyImmediate = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
  const targetPx = measureTarget();
  shrinking.value = false;
  lyricOpacity.value = 1;
  lyricWidth.value = targetPx;
  resizeWindow(targetPx);
  phase = "expanding";
};

/* 开始交换动画 */
const startSwapAnimation = (): void => {
  phase = "shrinking";
  shrinking.value = true;
  lyricWidth.value = 0;
  lyricOpacity.value = 0;
};

/* 歌词过渡结束 */
const onLyricTransitionEnd = (event: TransitionEvent): void => {
  if (event.propertyName !== "width") return;
  if (phase === "shrinking") {
    displayLine.value = currentLine.value;
    displayFallback.value = fallbackText.value;
    displayIndex.value = primaryIndex.value;
    displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
    const targetPx = measureTarget();
    resizeWindow(targetPx);
    /* 双 rAF 先让 class 切换使 transition 规则换到展开，下一帧再设新宽度才能正确触发过渡 */
    requestAnimationFrame(() => {
      if (phase !== "shrinking") return;
      shrinking.value = false;
      requestAnimationFrame(() => {
        if (phase !== "shrinking") return;
        phase = "expanding";
        lyricOpacity.value = 1;
        lyricWidth.value = targetPx;
      });
    });
  } else if (phase === "expanding") {
    phase = "idle";
  }
};

/* 开关切换后立即重算副行 + 同步窗口宽度，不走 swap 动画 */
watch([() => config.doubleLine, () => config.showTranslation], () => {
  displaySubText.value = computeSubText(displayIndex.value, displayLine.value);
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  lyricWidth.value = targetPx;
  resizeWindow(targetPx);
});

/* 尺寸/字重变化：重测宽度，不走 swap 动画 */
watch([() => config.scale, () => config.fontWeight], () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  lyricWidth.value = targetPx;
  resizeWindow(targetPx);
});

/* 歌词变化 */
watch([currentLine, fallbackText], () => {
  const newLine = currentLine.value;
  const changed = newLine
    ? displayIndex.value !== primaryIndex.value
    : displayFallback.value !== fallbackText.value;
  if (!changed) return;
  // 正在缩，等 transitionend 时自然会用最新数据
  if (phase === "shrinking") return;
  // 首次 paint 尚未完成或 lyricWidth 已经为 0 → 跳过 shrink 直接展开
  if (!hasPainted || lyricWidth.value === 0) {
    applyImmediate();
    return;
  }
  startSwapAnimation();
});

/* 根节点样式 */
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

/* 取消订阅 */
let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;
let unsubCursor: (() => void) | null = null;

/* 窗口高度变化 */
watch(
  windowHeight,
  (h) => {
    window.api.dynamicIsland.setHeight(h);
  },
  /* flush: "post" 让同一批响应式变化合并后只发一次 IPC */
  { flush: "post" },
);

onMounted(async () => {
  // 初始窗口宽度匹配 fallback 文本宽度，避免启动时窗口偏心
  resizeWindow(lyricWidth.value);
  // 确保初始 width 被浏览器 paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hasPainted = true;
    });
  });
  try {
    /* 获取保存的配置和模式 */
    const [saved, currentMode] = await Promise.all([
      window.api.config.get("dynamicIsland") as Promise<DynamicIslandSettings>,
      window.api.dynamicIsland.getMode(),
    ]);
    Object.assign(config, saved);
    mode.value = currentMode;
  } catch (error) {
    console.error("[dynamic-island] load state failed", error);
  }
  unsubConfig = window.api.dynamicIsland.onConfigChange((next) =>
    Object.assign(config, next as DynamicIslandSettings),
  );
  unsubMode = window.api.dynamicIsland.onModeChange((next) => {
    mode.value = next;
  });
  // 悬停判定
  unsubCursor = window.api.dynamicIsland.onCursorInside((inside) => {
    hovering.value = inside;
  });
});

onBeforeUnmount(() => {
  unsubConfig?.();
  unsubConfig = null;
  unsubMode?.();
  unsubMode = null;
  unsubCursor?.();
  unsubCursor = null;
});
</script>

<template>
  <div
    class="root"
    :class="[
      mode === 'snapped' ? 'is-snapped' : 'is-floating',
      { 'is-hidden': config.nonOcclusive && hovering },
    ]"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <div class="cover">
      <img
        :src="track?.cover || DEFAULT_COVER"
        alt="cover"
        draggable="false"
        @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
      />
    </div>
    <div
      class="lyric"
      :class="{ 'is-shrinking': shrinking }"
      :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }"
      @transitionend="onLyricTransitionEnd"
    >
      <div class="main-line">
        <IslandLyricLine
          v-if="displayLine"
          :line="displayLine"
          :font-size="fontSize"
          :font-weight="config.fontWeight"
          :word-by-word="config.wordByWord"
        />
        <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
          {{ displayFallback }}
        </div>
      </div>
      <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">
        {{ displaySubText }}
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
  transition:
    border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.2s ease-out;
}
/* opacity 不影响穿透判定，鼠标离开物理区域后自然恢复 */
.root.is-hidden {
  opacity: 0;
}
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
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
.lyric {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease-out;
}
.lyric.is-shrinking {
  transition:
    width 0.25s ease-in,
    opacity 0.25s ease-in;
}
.main-line {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.fallback {
  color: var(--di-played);
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: var(--di-played);
  /* 副行是辅助信息，独立于"未播放色"配置，用透明度做暗化 */
  opacity: 0.65;
  white-space: nowrap;
}
</style>
