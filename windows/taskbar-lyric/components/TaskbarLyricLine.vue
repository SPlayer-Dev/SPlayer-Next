<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { getTaskbarLyricCurrentMs } from "../composables/useNowPlayingSync";

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
const plainText = computed(
  () => props.text ?? props.line?.words.map((w) => w.word).join("") ?? "",
);

const wrapperRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const wrapperWidth = ref(0);
const contentWidth = ref(0);

const maxOffset = computed(() => {
  const diff = contentWidth.value - wrapperWidth.value;
  return diff > 0 ? diff + 10 : 0;
});
const isOverflow = computed(() => maxOffset.value > 0);
const scrollStyle = computed(() => {
  if (!isOverflow.value) return {};
  const duration = 2 + maxOffset.value / 30;
  const sign = props.anchor === "right" ? "" : "-";
  return {
    "--scroll-offset": `${sign}${maxOffset.value}px`,
    "--scroll-duration": `${duration.toFixed(2)}s`,
  };
});

let resizeObserver: ResizeObserver | null = null;

const updateMetrics = (): void => {
  if (wrapperRef.value) wrapperWidth.value = wrapperRef.value.clientWidth;
  if (contentRef.value) contentWidth.value = contentRef.value.scrollWidth;
};

const wordRefs: HTMLSpanElement[] = [];

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

const setWordRef = (el: Element | { $el?: Element } | null, index: number): void => {
  const target = el instanceof Element ? el : (el?.$el ?? null);
  if (target instanceof HTMLSpanElement) {
    wordRefs[index] = target;
  } else {
    delete wordRefs[index];
  }
};

let rafId = 0;
let lastWordProgress: string[] = [];

const resetRenderCache = (): void => {
  lastWordProgress = [];
  wordRefs.length = 0;
};

const renderFrame = (): void => {
  if (!useKaraoke.value || !props.line) {
    rafId = 0;
    return;
  }
  const currentMs = getTaskbarLyricCurrentMs();
  for (let i = 0; i < props.line.words.length; i++) {
    const el = wordRefs[i];
    if (!el) continue;
    const progress = getWordProgress(props.line.words[i], currentMs);
    if (lastWordProgress[i] !== progress) {
      lastWordProgress[i] = progress;
      el.style.setProperty("--p", progress);
    }
  }
  rafId = requestAnimationFrame(renderFrame);
};

const startRenderLoop = (): void => {
  if (rafId === 0 && useKaraoke.value) {
    rafId = requestAnimationFrame(renderFrame);
  }
};

const stopRenderLoop = (): void => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
};

watch(useKaraoke, (enabled) => {
  resetRenderCache();
  if (enabled) startRenderLoop();
  else stopRenderLoop();
});
watch(
  () => props.line,
  () => {
    resetRenderCache();
    nextTick(updateMetrics);
  },
);
watch(() => props.text, () => nextTick(updateMetrics));

onMounted(() => {
  resizeObserver = new ResizeObserver(updateMetrics);
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value);
  if (contentRef.value) resizeObserver.observe(contentRef.value);
  updateMetrics();
  startRenderLoop();
});

onBeforeUnmount(() => {
  stopRenderLoop();
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="wrapperRef" class="scroll-wrapper" :data-anchor="anchor">
    <div
      ref="contentRef"
      class="scroll-content"
      :class="{ 'is-scrolling': isOverflow }"
      :style="scrollStyle"
    >
      <template v-if="useKaraoke">
        <span
          v-for="(word, i) in line!.words"
          :key="i"
          :ref="(el) => setWordRef(el, i)"
          class="tb-word"
          >{{ word.word }}</span
        >
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
.scroll-wrapper[data-anchor="right"] {
  text-align: right;
}
.scroll-content {
  display: inline-block;
  will-change: transform;
}
.is-scrolling {
  animation: scroll-pingpong var(--scroll-duration) linear infinite alternate;
  animation-delay: 1.2s;
}
@keyframes scroll-pingpong {
  0%,
  15% {
    transform: translateX(0);
  }
  85%,
  100% {
    transform: translateX(var(--scroll-offset));
  }
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
