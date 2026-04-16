<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { getNowPlayingCurrentMs } from "../composables/useNowPlayingSync";

const props = defineProps<{
  line: LyricLine;
  fontSize: number;
  fontWeight: number;
  wordByWord: boolean;
}>();

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

const lineStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  fontWeight: props.fontWeight,
}));

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
};

const renderFrame = (): void => {
  if (props.wordByWord) {
    const currentMs = getNowPlayingCurrentMs();
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

watch(() => [props.wordByWord, props.line], resetRenderCache);

onMounted(() => {
  renderFrame();
});

onBeforeUnmount(() => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
});
</script>

<template>
  <div class="dl-line" :style="lineStyle">
    <span class="dl-line-inner">
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
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.dl-line-inner {
  display: inline-block;
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
