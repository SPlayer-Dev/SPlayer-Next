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
const contentRef = ref<HTMLElement | null>(null);
/** 内容超出容器的像素量 */
const overflowPx = ref(0);

/** 开始滚动的进度点：前 30% 停在开头 */
const SCROLL_START_AT = 0.3;
/** 结束提前量：比 endTime 早 2s 滚到底 */
const END_MARGIN_MS = 2000;

/**
 * 单词进度对应的 gradient --p 位置
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
  const px = progress * 6 - 3;
  const signed = px >= 0 ? `+ ${px.toFixed(2)}px` : `- ${(-px).toFixed(2)}px`;
  return `calc(${pct}% ${signed})`;
};

const lineStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  fontWeight: props.fontWeight,
  textAlign: props.align,
}));

/** 内容横向平移量：溢出才滚，0~30% 不动，30% 后线性滚到终点（endTime-2s） */
const scrollTransform = computed<string>(() => {
  const overflow = overflowPx.value;
  if (overflow <= 0) return "translateX(0)";
  const { startTime, endTime } = props.line;
  if (endTime <= startTime) return "translateX(0)";
  const end = Math.max(startTime + 1, endTime - END_MARGIN_MS);
  const duration = end - startTime;
  if (duration <= 0) return "translateX(0)";
  const progress = Math.max(0, Math.min(1, (props.currentMs - startTime) / duration));
  if (progress <= SCROLL_START_AT) return "translateX(0)";
  const ratio = (progress - SCROLL_START_AT) / (1 - SCROLL_START_AT);
  const offset = Math.round(overflow * ratio);
  return `translateX(-${offset}px)`;
});

const measure = (): void => {
  const outer = containerRef.value;
  const inner = contentRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    return;
  }
  overflowPx.value = Math.max(0, inner.scrollWidth - outer.clientWidth);
};

watch(() => props.line, () => nextTick(measure));

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
    <div ref="containerRef" class="dl-line" :style="lineStyle">
      <span ref="contentRef" class="dl-line-inner" :style="{ transform: scrollTransform }">
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
  padding: 0 24px;
  box-sizing: border-box;
  transform: translate3d(0, var(--dl-y, 0px), 0) translateY(0);
  transition:
    transform 0.6s cubic-bezier(0.55, 0, 0.1, 1),
    opacity 0.6s cubic-bezier(0.55, 0, 0.1, 1);
  will-change: transform, opacity;
}
.dl-line {
  position: relative;
  width: 100%;
  line-height: normal;
  padding: 4px 0;
  overflow: hidden;
  white-space: nowrap;
  transition: font-size 0.6s cubic-bezier(0.55, 0, 0.1, 1);
}
.dl-line-inner {
  display: inline-block;
  will-change: transform;
}
/*
 * 逐字：gradient 围绕 var(--p) 展开 6px 软边。
 * --p 范围被 JS 扩到 calc(-3px .. 100%+3px)：极值位过渡带被挤出可视区 → 纯色无残留。
 */
.dl-word {
  --p: 0%;
  display: inline;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: linear-gradient(
    90deg,
    var(--dl-played) 0%,
    var(--dl-played) calc(var(--p) - 3px),
    var(--dl-unplayed) calc(var(--p) + 3px),
    var(--dl-unplayed) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
}
.dl-static {
  display: inline-block;
  color: var(--dl-played);
  transition: color 0.6s cubic-bezier(0.55, 0, 0.1, 1);
}
.dl-static.is-unplayed {
  color: var(--dl-unplayed);
}
</style>
