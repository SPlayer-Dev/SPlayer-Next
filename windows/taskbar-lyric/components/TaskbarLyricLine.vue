<script setup lang="ts">
import type { LyricLine } from "lyric-kit";

import { getWordSweepProgress } from "lyric-kit";
import { getNowPlayingCurrentMs } from "@windows/shared/composables/useNowPlayingSync";
import {
  computeHorizontalScrollRange,
  computeLyricScrollOffset,
} from "@windows/shared/lyricScroll";

const props = withDefaults(
  defineProps<{
    line?: LyricLine;
    text?: string;
    wordByWord?: boolean;
    anchor?: "left" | "right";
    /** 决定滚动进度的歌词行，翻译行传对应的原文行，缺省为 line */
    timingLine?: LyricLine;
  }>(),
  { wordByWord: false, anchor: "left" },
);

const useKaraoke = computed(() => props.wordByWord && !!props.line);
const plainText = computed(() => props.text ?? props.line?.words.map((w) => w.word).join("") ?? "");
const scrollTiming = computed(() => props.timingLine ?? props.line);

const wrapperRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const overflowPx = ref(0);
const isOverflow = computed(() => overflowPx.value > 0);
/** 可见容器宽度，用于定位演唱焦点 */
let containerWidth = 0;
/** 成为当前行的时刻，迟到激活的行从此刻重新开始滚动 */
let scrollActivatedAtMs = 0;

/** 溢出时强制左对齐，内容起点恒为 0，无需读取 offsetLeft */
const measure = (): void => {
  const outer = wrapperRef.value;
  const inner = contentRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    return;
  }
  containerWidth = outer.clientWidth;
  overflowPx.value = computeHorizontalScrollRange(containerWidth, inner.scrollWidth, 0).distance;
};

/** 溢出时向左滚动（与桌面歌词一致），有逐字时间时跟随演唱位置 */
const getScrollTransform = (currentMs: number): string => {
  const timing = scrollTiming.value;
  if (overflowPx.value <= 0 || !timing) return "translateX(0)";
  const offset = computeLyricScrollOffset({
    currentMs,
    activatedAtMs: scrollActivatedAtMs,
    timingLine: timing,
    containerWidth,
    range: { startOffset: 0, distance: overflowPx.value },
  });
  return `translateX(${offset.toFixed(3)}px)`;
};

const wordRefs: HTMLSpanElement[] = [];

const getWordProgress = (
  word: { startTime: number; endTime: number },
  currentMs: number,
): string => {
  const progress = getWordSweepProgress(word, props.line?.startTime ?? 0, currentMs);
  const pct = (progress * 100).toFixed(1);
  const px = progress * 4 - 2;
  const signed = px >= 0 ? `+ ${px.toFixed(2)}px` : `- ${(-px).toFixed(2)}px`;
  return `calc(${pct}% ${signed})`;
};

const setWordRef = (el: Element | { $el?: Element } | null, index: number): void => {
  const target = el instanceof Element ? el : (el?.$el ?? null);
  if (target instanceof HTMLSpanElement) {
    wordRefs[index] = target;
  } else {
    delete wordRefs[index];
  }
};

let resizeObserver: ResizeObserver | null = null;
let rafId = 0;
let lastTransform = "";
let lastWordProgress: string[] = [];

const resetRenderCache = (): void => {
  lastTransform = "";
  lastWordProgress = [];
  wordRefs.length = 0;
};

const needsRaf = (): boolean => useKaraoke.value || (overflowPx.value > 0 && !!scrollTiming.value);

const renderFrame = (): void => {
  if (!needsRaf()) {
    rafId = 0;
    if (contentRef.value && lastTransform !== "") {
      lastTransform = "";
      contentRef.value.style.transform = "";
    }
    return;
  }
  const currentMs = getNowPlayingCurrentMs();

  if (contentRef.value) {
    const transform = getScrollTransform(currentMs);
    if (transform !== lastTransform) {
      lastTransform = transform;
      contentRef.value.style.transform = transform;
    }
  }

  if (useKaraoke.value && props.line) {
    for (let i = 0; i < props.line.words.length; i++) {
      const el = wordRefs[i];
      if (!el) continue;
      const progress = getWordProgress(props.line.words[i], currentMs);
      if (lastWordProgress[i] !== progress) {
        lastWordProgress[i] = progress;
        el.style.setProperty("--p", progress);
      }
    }
  }

  rafId = requestAnimationFrame(renderFrame);
};

const startRenderLoop = (): void => {
  if (rafId === 0 && needsRaf()) rafId = requestAnimationFrame(renderFrame);
};

/** 从成为当前行的时刻重新开始横向滚动 */
const activateScroll = (): void => {
  scrollActivatedAtMs = Math.max(scrollTiming.value?.startTime ?? 0, getNowPlayingCurrentMs());
};

watch(
  () => props.line,
  () => {
    resetRenderCache();
    nextTick(measure);
  },
);
watch(scrollTiming, activateScroll);
watch([overflowPx, useKaraoke, scrollTiming], startRenderLoop);
watch(
  () => props.text,
  () => nextTick(measure),
);

onMounted(() => {
  resizeObserver = new ResizeObserver(measure);
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value);
  if (contentRef.value) resizeObserver.observe(contentRef.value);
  activateScroll();
  measure();
  startRenderLoop();
});

onBeforeUnmount(() => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="scroll-wrapper"
    :data-anchor="anchor"
    :class="{ 'is-overflow': isOverflow }"
  >
    <div ref="contentRef" class="scroll-content">
      <template v-if="useKaraoke">
        <span
          v-for="(word, i) in line!.words"
          :key="i"
          :ref="(el) => setWordRef(el, i)"
          class="tb-word"
        >
          {{ word.word }}
        </span>
      </template>
      <span v-else>{{ plainText }}</span>
    </div>
  </div>
</template>

<style scoped>
.scroll-wrapper {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}
/* 未溢出时根据锚定方向对齐短文本；溢出时强制左对齐，让滚动从头开始 */
.scroll-wrapper[data-anchor="right"]:not(.is-overflow) {
  text-align: right;
}
.scroll-content {
  display: inline-block;
  pointer-events: auto;
  will-change: transform;
}
.tb-word {
  --p: 0%;
  display: inline;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: linear-gradient(
    90deg,
    var(--tbl-played) 0%,
    var(--tbl-played) calc(var(--p) - 2px),
    var(--tbl-unplayed) calc(var(--p) + 2px),
    var(--tbl-unplayed) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
}
</style>
