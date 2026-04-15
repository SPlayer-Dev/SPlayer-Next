<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { getNowPlayingCurrentMs } from "../../desktop-lyric/composables/useNowPlayingSync";

const props = defineProps<{
  line: LyricLine;
  fontSize: number;
  fontWeight: number;
  wordByWord: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const wordRefs: HTMLSpanElement[] = [];
const overflowPx = ref(0);

/** 开始滚动的进度点 */
const SCROLL_START_AT = 0.3;
/** 结束提前量 */
const END_MARGIN_MS = 2000;

const getWordProgress = (
  word: { startTime: number; endTime: number },
  currentMs: number,
): string => {
  const span = word.endTime - word.startTime;
  const progress =
    span <= 0
      ? currentMs >= word.startTime
        ? 1
        : 0
      : Math.max(0, Math.min(1, (currentMs - word.startTime) / span));
  const pct = (progress * 100).toFixed(1);
  const px = progress * 4 - 2;
  const signed = px >= 0 ? `+ ${px.toFixed(2)}px` : `- ${(-px).toFixed(2)}px`;
  return `calc(${pct}% ${signed})`;
};

const lineStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  fontWeight: props.fontWeight,
}));

const getScrollTransform = (currentMs: number): string => {
  const overflow = overflowPx.value;
  if (overflow <= 0) return "translateX(0)";
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

const measure = (): void => {
  const outer = containerRef.value;
  const inner = contentRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    return;
  }
  const diff = inner.getBoundingClientRect().width - outer.getBoundingClientRect().width;
  overflowPx.value = diff > 0.5 ? diff : 0;
};

const setWordRef = (el: Element | { $el?: Element } | null, index: number): void => {
  const target = el instanceof Element ? el : (el?.$el ?? null);
  if (target instanceof HTMLSpanElement) {
    wordRefs[index] = target;
  } else {
    delete wordRefs[index];
  }
};

let resizeObs: ResizeObserver | null = null;
let rafId = 0;
let lastTransform = "";
let lastWordProgress: string[] = [];

const resetRenderCache = (): void => {
  lastTransform = "";
  lastWordProgress = [];
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
  if (props.wordByWord) {
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

watch(() => [props.wordByWord, props.line, overflowPx.value], resetRenderCache);
watch(
  () => props.fontSize,
  () => nextTick(measure),
);

onMounted(() => {
  measure();
  resizeObs = new ResizeObserver(measure);
  if (containerRef.value) resizeObs.observe(containerRef.value);
  renderFrame();
});

onBeforeUnmount(() => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  resizeObs?.disconnect();
  resizeObs = null;
});
</script>

<template>
  <div ref="containerRef" class="dl-line" :style="lineStyle">
    <span ref="contentRef" class="dl-line-inner">
      <template v-if="wordByWord">
        <span
          v-for="(word, i) in line.words"
          :key="i"
          :ref="(el) => setWordRef(el, i)"
          class="dl-word"
          >{{ word.word }}</span
        >
      </template>
      <span v-else class="dl-static">{{ line.words.map((w) => w.word).join("") }}</span>
    </span>
  </div>
</template>

<style scoped>
.dl-line {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
.dl-line-inner {
  display: inline-block;
  will-change: transform;
  text-align: center;
}
.dl-word {
  --p: 0%;
  display: inline;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: linear-gradient(
    90deg,
    var(--di-played) 0%,
    var(--di-played) calc(var(--p) - 2px),
    var(--di-unplayed) calc(var(--p) + 2px),
    var(--di-unplayed) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
}
.dl-static {
  display: inline-block;
  color: var(--di-unplayed);
}
</style>
