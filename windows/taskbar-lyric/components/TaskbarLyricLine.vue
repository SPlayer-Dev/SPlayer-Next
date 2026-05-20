<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { getWordSweepProgress } from "@shared/utils/lyricSync";
import { getNowPlayingCurrentMs } from "@windows/shared/composables/useNowPlayingSync";

const props = withDefaults(
  defineProps<{
    line?: LyricLine;
    text?: string;
    wordByWord?: boolean;
    anchor?: "left" | "right";
  }>(),
  { wordByWord: false, anchor: "left" },
);

const useKaraoke = computed(() => props.wordByWord && !!props.line);
const plainText = computed(() => props.text ?? props.line?.words.map((w) => w.word).join("") ?? "");

const wrapperRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const overflowPx = ref(0);
const isOverflow = computed(() => overflowPx.value > 0);

/** 前 30% 停在开头 */
const SCROLL_START_AT = 0.3;
/** 比 endTime 早多少滚到底 */
const END_MARGIN_MS = 2000;

const measure = (): void => {
  const outer = wrapperRef.value;
  const inner = contentRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    return;
  }
  const diff = inner.getBoundingClientRect().width - outer.getBoundingClientRect().width;
  overflowPx.value = diff > 0.5 ? diff : 0;
};

/** 根据进度计算平移量——溢出时始终向左滚（与桌面歌词一致），不做来回 */
const getScrollTransform = (currentMs: number): string => {
  const overflow = overflowPx.value;
  if (overflow <= 0 || !props.line) return "translateX(0)";
  const { startTime, endTime } = props.line;
  if (endTime <= startTime) return "translateX(0)";
  const end = Math.max(startTime + 1, endTime - END_MARGIN_MS);
  const duration = end - startTime;
  if (duration <= 0) return "translateX(0)";
  const progress = Math.max(0, Math.min(1, (currentMs - startTime) / duration));
  if (progress <= SCROLL_START_AT) return "translateX(0)";
  const ratio = (progress - SCROLL_START_AT) / (1 - SCROLL_START_AT);
  const offset = overflow * ratio;
  return `translateX(-${offset.toFixed(3)}px)`;
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

const renderFrame = (): void => {
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

watch(
  () => props.line,
  () => {
    resetRenderCache();
    nextTick(measure);
  },
);
watch(
  () => props.text,
  () => nextTick(measure),
);

onMounted(() => {
  resizeObserver = new ResizeObserver(measure);
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value);
  if (contentRef.value) resizeObserver.observe(contentRef.value);
  measure();
  rafId = requestAnimationFrame(renderFrame);
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
