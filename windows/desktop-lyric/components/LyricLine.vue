<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign } from "@shared/types/settings";

const props = defineProps<{
  line: LyricLine;
  currentMs: number;
  fontSize: number;
  fontWeight: number;
  align: DesktopLyricAlign;
  wordByWord: boolean;
  /** 静态模式下作为「下一行」渲染 */
  isNext: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);
const inlineRef = ref<HTMLElement | null>(null);
const overflowPx = ref(0);

/**
 * 单词过渡效果
 * @param word 单词时间段
 */
const wordP = (word: { startTime: number; endTime: number }): string => {
  const span = word.endTime - word.startTime;
  const progress =
    span <= 0
      ? props.currentMs >= word.startTime
        ? 1
        : 0
      : Math.max(0, Math.min(1, (props.currentMs - word.startTime) / span));
  const pct = (progress * 100).toFixed(1);
  // 确保未播放单词不展示过渡
  const px = progress * 6 - 3;
  const signed = px >= 0 ? `+ ${px.toFixed(2)}px` : `- ${(-px).toFixed(2)}px`;
  return `calc(${pct}% ${signed})`;
};

const lineStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  fontWeight: props.fontWeight,
  textAlign: props.align,
}));

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

watch(
  () => props.line,
  () => requestAnimationFrame(measure),
);

const marquee = computed(() => overflowPx.value > 0);
const marqueeStyle = computed(() =>
  marquee.value ? { "--dl-overflow": `${overflowPx.value}px` } : {},
);

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
            :style="{ '--p': wordP(word) }"
            >{{ word.word }}</span
          >
        </template>
        <span v-else class="dl-static" :class="{ 'is-unplayed': isNext }">
          {{ line.words.map((w) => w.word).join("") }}
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.dl-line-block {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  transform: translate3d(0, var(--dl-y, 0px), 0) translateY(0);
  transition:
    transform 0.6s cubic-bezier(0.55, 0, 0.1, 1),
    opacity 0.6s cubic-bezier(0.55, 0, 0.1, 1);
  will-change: transform, opacity;
}
.dl-line {
  position: relative;
  width: 100%;
  line-height: 1.25;
  overflow: hidden;
  white-space: nowrap;
  transition: font-size 0.6s cubic-bezier(0.55, 0, 0.1, 1);
}
.dl-line-inner {
  display: inline-block;
  will-change: transform;
}
.dl-word {
  --p: 0%;
  display: inline;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: linear-gradient(
    90deg,
    var(--dl-line-color, var(--dl-played)) 0%,
    var(--dl-line-color, var(--dl-played)) calc(var(--p) - 3px),
    var(--dl-unplayed) calc(var(--p) + 3px),
    var(--dl-unplayed) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
}
.dl-static {
  display: inline-block;
  color: var(--dl-line-color, var(--dl-played));
  transition: color 0.6s cubic-bezier(0.55, 0, 0.1, 1);
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
}
.dl-static.is-unplayed {
  color: var(--dl-unplayed);
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
