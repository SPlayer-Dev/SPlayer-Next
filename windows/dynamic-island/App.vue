<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import { pickAdvanceOnEndIndex } from "@shared/utils/lyricSync";
import { useNowPlayingSync } from "@windows/shared/composables/useNowPlayingSync";
import { useDragWindow } from "./composables/useDragWindow";
import { isMac } from "@/utils/config";

const config = reactive<DynamicIslandSettings>({
  scale: 1,
  fontWeight: 500,
  fontFamily: "",
  wordByWord: true,
  playedColor: "rgba(255, 255, 255, 1)",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 1)",
  alwaysOnTop: true,
  snapCentered: true,
  notchFusion: false,
  nonOcclusive: false,
  doubleLine: false,
  showTranslation: false,
  useCSSDrag: false,
});

const NOTCH_WIDTH = 181;
const NOTCH_HEIGHT = 29;
const NOTCH_TOP_FILL = 3;
const SHAPE_SIDE_OVERHANG = 5;
const MIN_SHAPE_WIDTH = NOTCH_WIDTH + SHAPE_SIDE_OVERHANG * 2;
const MAX_WINDOW_WIDTH = 620;
const MAX_WINDOW_WIDTH_RATIO = 0.55;
const MIN_LYRIC_SCALE = 0.78;

/* 悬停隐藏：非遮挡模式下仅在鼠标悬停时透明 */
const hovering = ref(false);

/* 窗口尺寸计算 */
const mainRowHeight = computed(() => Math.round(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale));

/* 主元素尺寸 */
const padX = computed(() => Math.round(mainRowHeight.value * 0.4));
const gap = computed(() => Math.round(mainRowHeight.value * 0.25));
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65));
const coverRadius = computed(() => Math.max(6, Math.round(coverSize.value * 0.35)));
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6));
const shapeBottomRadius = computed(() => Math.max(14, Math.round(coverRadius.value * 2)));

/* 副行尺寸 */
const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)));
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2));

const { track, lyric, primaryIndex } = useNowPlayingSync({
  pickIndex: pickAdvanceOnEndIndex,
  logTag: "dynamic-island",
});
const { onRootPointerDown } = useDragWindow();

/* 窗口模式 */
const mode = ref<"snapped" | "floating">("snapped");
const viewportWidth = ref(Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH));
const viewportHeight = ref(Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT));
const animatedShapeWidth = ref(viewportWidth.value);
const notchFusionEnabled = computed(() => isMac && config.notchFusion && mode.value === "snapped");

/* 文本测量：优先使用 config.fontFamily，确保与渲染一致 */
const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string, sizePx: number = fontSize.value): number => {
  const family = config.fontFamily || getComputedStyle(document.documentElement).fontFamily;
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

const contentHeight = computed(
  () => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0),
);

/* 窗口高度 */
const windowHeight = computed(
  () => contentHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0),
);

// 回弹 easing cubic-bezier(0.34, 1.56, 0.64, 1) 峰值约 1.10
// 15% 留安全余量避免文本被裁
const BOUNCE_OVERSHOOT = 0.15;

/* 歌词宽度 */
const rawLyricWidth = ref(measureTextWidth(displayFallback.value));
const lyricWidth = ref(rawLyricWidth.value);
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

const getRendererWindowLimit = (): number =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.min(MAX_WINDOW_WIDTH, Math.floor(window.screen.width * MAX_WINDOW_WIDTH_RATIO)),
  );

const fixedContentWidth = computed(() => padX.value * 2 + coverSize.value + gap.value);
const shapeExtraWidth = computed(() => (notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG * 2 : 0));

const maxLyricSlotWidth = computed(() => {
  const windowLimit = getRendererWindowLimit();
  const currentWindowWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
  return Math.max(
    1,
    Math.min(windowLimit, currentWindowWidth) - fixedContentWidth.value - shapeExtraWidth.value,
  );
});

const getLyricSlotWidth = (lyricPx: number): number =>
  notchFusionEnabled.value
    ? Math.min(Math.max(1, Math.round(lyricPx)), maxLyricSlotWidth.value)
    : Math.max(1, Math.round(lyricPx));

/* 计算窗口宽度 */
const computeWindowWidth = (lyricPx: number): number => {
  const bounceExtra = Math.ceil(lyricPx * BOUNCE_OVERSHOOT);
  return Math.max(
    notchFusionEnabled.value ? MIN_SHAPE_WIDTH : 1,
    fixedContentWidth.value + lyricPx + bounceExtra + shapeExtraWidth.value,
  );
};

/* 调整窗口宽度 */
const resizeWindow = (lyricPx: number): void => {
  const targetWidth = computeWindowWidth(lyricPx);
  if (!notchFusionEnabled.value) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    return;
  }

  const currentWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
  if (targetWidth >= currentWidth) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    requestAnimationFrame(() => {
      animatedShapeWidth.value = targetWidth;
    });
    return;
  }

  animatedShapeWidth.value = targetWidth;
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
  }
  pendingWindowShrinkTimer = window.setTimeout(() => {
    pendingWindowShrinkTimer = null;
    if (notchFusionEnabled.value) {
      window.api.dynamicIsland.resize(targetWidth);
    }
  }, 520);
};

const applyMeasuredWidth = (targetPx: number): void => {
  rawLyricWidth.value = targetPx;
  lyricWidth.value = getLyricSlotWidth(targetPx);
  resizeWindow(targetPx);
};

const truncateTextToWidth = (text: string, maxWidth: number, sizePx: number): string => {
  if (!text || measureTextWidth(text, sizePx) <= maxWidth) return text;
  const ellipsis = "...";
  const ellipsisWidth = measureTextWidth(ellipsis, sizePx);
  if (maxWidth <= ellipsisWidth) return ellipsis;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureTextWidth(`${text.slice(0, mid)}${ellipsis}`, sizePx) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
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
  applyMeasuredWidth(targetPx);
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
    rawLyricWidth.value = targetPx;
    resizeWindow(targetPx);
    /* 双 rAF 先让 class 切换使 transition 规则换到展开，下一帧再设新宽度才能正确触发过渡 */
    requestAnimationFrame(() => {
      if (phase !== "shrinking") return;
      shrinking.value = false;
      requestAnimationFrame(() => {
        if (phase !== "shrinking") return;
        phase = "expanding";
        lyricOpacity.value = 1;
        lyricWidth.value = getLyricSlotWidth(targetPx);
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
  applyMeasuredWidth(targetPx);
});

/* 尺寸/字重变化：重测宽度，不走 swap 动画 */
watch([() => config.scale, () => config.fontWeight, () => config.fontFamily], () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch(notchFusionEnabled, () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
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

const lyricScale = computed(() => {
  if (!notchFusionEnabled.value) return 1;
  const rawWidth = Math.max(1, rawLyricWidth.value);
  const slotWidth = Math.max(1, lyricWidth.value);
  return Math.max(MIN_LYRIC_SCALE, Math.min(1, slotWidth / rawWidth));
});

const lyricLayoutWidth = computed(() =>
  Math.max(1, Math.floor(Math.max(1, lyricWidth.value) / lyricScale.value)),
);

const displayMainText = computed(() =>
  displayLine.value ? lineText(displayLine.value) : displayFallback.value,
);

const fittedMainText = computed(() =>
  notchFusionEnabled.value
    ? truncateTextToWidth(displayMainText.value, lyricLayoutWidth.value, fontSize.value)
    : displayMainText.value,
);

const mainTextTruncated = computed(() => fittedMainText.value !== displayMainText.value);

const fittedDisplayLine = computed<LyricLine | null>(() => {
  const line = displayLine.value;
  if (!line || !mainTextTruncated.value) return line;
  return {
    ...line,
    words: [
      {
        startTime: line.startTime,
        endTime: line.endTime,
        word: fittedMainText.value,
      },
    ],
  };
});

const fittedSubText = computed(() =>
  notchFusionEnabled.value
    ? truncateTextToWidth(displaySubText.value, lyricLayoutWidth.value, subFontSize.value)
    : displaySubText.value,
);

const shapeWidth = computed(() =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.round(notchFusionEnabled.value ? animatedShapeWidth.value : viewportWidth.value),
  ),
);
const shapeHeight = computed(() => Math.max(windowHeight.value, Math.round(viewportHeight.value)));

const notchPath = computed(() => {
  const width = shapeWidth.value;
  const height = shapeHeight.value;
  const overhang = Math.min(SHAPE_SIDE_OVERHANG, width / 4);
  const bodyLeft = overhang;
  const bodyRight = width - overhang;
  const topArc = Math.min(overhang, height / 4);
  const bottomRadius = Math.min(shapeBottomRadius.value, width / 2, height / 2);

  return [
    "M 0 0",
    `L ${width} 0`,
    `Q ${bodyRight} 0 ${bodyRight} ${topArc}`,
    `L ${bodyRight} ${height - bottomRadius}`,
    `Q ${bodyRight} ${height} ${bodyRight - bottomRadius} ${height}`,
    `L ${bodyLeft + bottomRadius} ${height}`,
    `Q ${bodyLeft} ${height} ${bodyLeft} ${height - bottomRadius}`,
    `L ${bodyLeft} ${topArc}`,
    `Q ${bodyLeft} 0 0 0`,
    "Z",
  ].join(" ");
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
  "--di-side-overhang": `${notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG : 0}px`,
  "--di-row": `${mainRowHeight.value}px`,
  "--di-content-height": `${contentHeight.value}px`,
  "--di-notch": `${NOTCH_HEIGHT}px`,
  "--di-shape-width": `${shapeWidth.value}px`,
  "--di-fusion-content-width": `${Math.max(1, shapeWidth.value - SHAPE_SIDE_OVERHANG * 2)}px`,
  "--di-snap-radius": `${snapRadius.value}px`,
  "--di-lyric-scale": lyricScale.value,
  fontFamily: config.fontFamily || undefined,
  "-webkit-app-region": config.useCSSDrag ? "drag" : "no-drag",
}));

const syncViewportSize = (): void => {
  viewportWidth.value = Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH);
  viewportHeight.value = Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT);
  if (!notchFusionEnabled.value) {
    animatedShapeWidth.value = viewportWidth.value;
  }
};

watch(
  maxLyricSlotWidth,
  () => {
    if (phase === "shrinking") return;
    lyricWidth.value = getLyricSlotWidth(rawLyricWidth.value);
  },
  { flush: "post" },
);

/* 取消订阅 */
let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;
let unsubCursor: (() => void) | null = null;
let pendingWindowShrinkTimer: number | null = null;

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
  syncViewportSize();
  window.addEventListener("resize", syncViewportSize);
  // 初始窗口宽度匹配 fallback 文本宽度，避免启动时窗口偏心
  resizeWindow(rawLyricWidth.value);
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
  window.removeEventListener("resize", syncViewportSize);
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
    pendingWindowShrinkTimer = null;
  }
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
      {
        'is-hidden': config.nonOcclusive && hovering,
        'is-notch-fusion': notchFusionEnabled,
      },
    ]"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <svg
      v-if="notchFusionEnabled"
      class="notch-shape"
      :viewBox="`0 0 ${shapeWidth} ${shapeHeight}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="notchPath" fill="var(--di-bg)" />
    </svg>
    <div class="content">
      <div class="cover">
        <img
          :src="track?.cover || DEFAULT_COVER"
          alt="cover"
          draggable="false"
          decoding="async"
          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
        />
      </div>
      <div
        class="lyric"
        :class="{ 'is-shrinking': shrinking }"
        :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }"
        @transitionend="onLyricTransitionEnd"
      >
        <div
          class="lyric-scale"
          :style="
            notchFusionEnabled
              ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` }
              : {}
          "
        >
          <div class="main-line">
            <IslandLyricLine
              v-if="fittedDisplayLine"
              :line="fittedDisplayLine"
              :font-size="fontSize"
              :font-weight="config.fontWeight"
              :word-by-word="config.wordByWord && !mainTextTruncated"
            />
            <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
              {{ fittedMainText }}
            </div>
          </div>
          <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">
            {{ fittedSubText }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  cursor: move;
  color: var(--di-played);
  transition:
    border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.2s ease-out;
}
/* opacity 不影响穿透判定，鼠标离开物理区域后自然恢复 */
.root.is-hidden {
  opacity: 0;
}
.root.is-notch-fusion {
  width: 100%;
}
.root:not(.is-notch-fusion) {
  width: fit-content;
  background: var(--di-bg);
}
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
.root.is-snapped.is-notch-fusion {
  background: transparent;
  border-radius: 0;
}
.root.is-floating {
  background: var(--di-bg);
  border-radius: 999px;
}
.notch-shape {
  position: absolute;
  top: 0;
  left: 50%;
  width: var(--di-shape-width);
  height: 100%;
  transform: translateX(-50%);
  pointer-events: none;
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  min-width: 0;
  height: 100%;
  padding: 0 var(--di-padx);
  box-sizing: border-box;
}
.root:not(.is-notch-fusion) .content {
  width: fit-content;
}
.root.is-notch-fusion .content {
  width: 100%;
}
.root.is-snapped.is-notch-fusion .content {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--di-fusion-content-width);
  height: var(--di-content-height);
  transform: translateX(-50%);
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
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
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
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
.lyric-scale {
  flex: 0 0 auto;
  min-width: 0;
  transform-origin: center center;
}
.main-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.fallback {
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  /* 副行是辅助信息，独立于"未播放色"配置，用透明度做暗化 */
  opacity: 0.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
