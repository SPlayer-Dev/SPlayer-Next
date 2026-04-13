<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign } from "@shared/types/settings";

const props = defineProps<{
  line: LyricLine;
  currentMs: number;
  fontSize: number;
  fontWeight: number;
  align: DesktopLyricAlign;
  wordByWord: boolean;
  showTranslation: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);
const inlineRef = ref<HTMLElement | null>(null);
const overflowPx = ref(0);

const lineProgress = computed(() => {
  const line = props.line;
  const span = line.endTime - line.startTime;
  if (span <= 0) return props.currentMs >= line.startTime ? 1 : 0;
  return Math.max(0, Math.min(1, (props.currentMs - line.startTime) / span));
});

const wordProgress = (word: { startTime: number; endTime: number }): number => {
  const span = word.endTime - word.startTime;
  if (span <= 0) return props.currentMs >= word.startTime ? 1 : 0;
  return Math.max(0, Math.min(1, (props.currentMs - word.startTime) / span));
};

const gradient = (progress: number): string => {
  const stop = (progress * 100).toFixed(3);
  return `linear-gradient(90deg, var(--dl-played) 0%, var(--dl-played) ${stop}%, var(--dl-unplayed) ${stop}%, var(--dl-unplayed) 100%)`;
};

const lineStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  fontWeight: props.fontWeight,
  textAlign: props.align,
}));

const transStyle = computed(() => ({
  fontSize: `${Math.round(props.fontSize * 0.67)}px`,
  textAlign: props.align,
}));

const wholeBackground = computed(() => gradient(lineProgress.value));

const measure = (): void => {
  const outer = containerRef.value;
  const inner = inlineRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    return;
  }
  const diff = inner.scrollWidth - outer.clientWidth;
  overflowPx.value = diff > 2 ? diff : 0;
};

let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && containerRef.value) {
    resizeObs = new ResizeObserver(measure);
    resizeObs.observe(containerRef.value);
  }
});
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  resizeObs = null;
});
watch(
  () => props.line,
  () => requestAnimationFrame(measure),
);

const marquee = computed(() => overflowPx.value > 0);
const marqueeStyle = computed(() =>
  marquee.value ? { "--dl-overflow": `${overflowPx.value}px` } : {},
);
</script>

<template>
  <div class="dl-line-block">
    <div ref="containerRef" class="dl-line" :style="lineStyle" :class="{ 'is-marquee': marquee }">
      <span ref="inlineRef" class="dl-line-inner" :style="marqueeStyle">
        <template v-if="wordByWord">
          <span
            v-for="(word, i) in line.words"
            :key="i"
            class="dl-word"
            :style="{ backgroundImage: gradient(wordProgress(word)) }"
            >{{ word.word }}</span
          >
        </template>
        <span v-else class="dl-word" :style="{ backgroundImage: wholeBackground }">
          {{ line.words.map((w) => w.word).join("") }}
        </span>
      </span>
    </div>
    <div v-if="showTranslation && line.translatedLyric" class="dl-trans" :style="transStyle">
      {{ line.translatedLyric }}
    </div>
  </div>
</template>

<style scoped>
.dl-line-block {
  width: 100%;
}
.dl-line {
  position: relative;
  width: 100%;
  line-height: 1.25;
  overflow: hidden;
  white-space: nowrap;
}
.dl-line-inner {
  display: inline-block;
  will-change: transform;
}
.dl-word {
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background-size: 100% 100%;
}
.dl-trans {
  line-height: 1.3;
  color: var(--dl-trans);
  margin-top: 2px;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dl-line.is-marquee .dl-line-inner {
  animation: dl-marquee 8s ease-in-out infinite;
}
@keyframes dl-marquee {
  0%,
  15% {
    transform: translateX(0);
  }
  50%,
  65% {
    transform: translateX(calc(-1 * var(--dl-overflow)));
  }
  100% {
    transform: translateX(0);
  }
}
</style>
