<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign } from "@shared/types/settings";
import { getWordSweepProgress } from "@shared/utils/lyricSync";
import { getNowPlayingCurrentMs } from "@windows/shared/composables/useNowPlayingSync";

const props = defineProps<{
  line: LyricLine;
  fontSize: number;
  fontWeight: number;
  align: DesktopLyricAlign;
  wordByWord: boolean;
  /** 静态模式下作为“下一行”渲染 */
  isNext: boolean;
  /** 是否启用文本背景遮罩 */
  backgroundMask: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const wordRefs: HTMLSpanElement[] = [];
/** 内容超出容器的像素量 */
const overflowPx = ref(0);

/** 开始滚动的进度点：前 30% 停在开头 */
const SCROLL_START_AT = 0.3;
/** 结束提前量：比 endTime 早多少滚到底 */
const END_MARGIN_MS = 2000;

/** 单词进度对应的 gradient --p 位置 */
const getWordProgress = (
  word: { startTime: number; endTime: number },
  currentMs: number,
): string => {
  const progress = getWordSweepProgress(word, props.line.startTime, currentMs);
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

/**
 * 内容横向平移量：溢出才滚，0~30% 不动，30% 后线性滚到终点（endTime-2s）
 * 不做 Math.round，否则在 overflow 小时会出现明显的像素跳动。
 */
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

/**
 * 测量内容溢出量
 * 使用 getBoundingClientRect().width 保留亚像素精度，避免滚动终点误差。
 */
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

const needsRaf = (): boolean => props.wordByWord || overflowPx.value > 0;

const renderFrame = (): void => {
  if (!needsRaf()) {
    rafId = 0;
    return;
  }
  const currentMs = getNowPlayingCurrentMs();

  if (contentRef.value && overflowPx.value > 0) {
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

const startRenderLoop = (): void => {
  if (rafId === 0 && needsRaf()) {
    rafId = requestAnimationFrame(renderFrame);
  }
};

const stopRenderLoop = (): void => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
};

// 字号变化兜底
watch(
  () => props.fontSize,
  () => nextTick(measure),
);

watch(
  () => [props.wordByWord, props.line, overflowPx.value],
  () => {
    resetRenderCache();
    if (needsRaf()) {
      startRenderLoop();
    } else {
      stopRenderLoop();
      if (contentRef.value) contentRef.value.style.transform = "";
    }
  },
);

/** 字号 CSS transition 结束后重测 */
const onTransitionEnd = (event: TransitionEvent): void => {
  if (event.propertyName === "font-size") measure();
};

onMounted(() => {
  measure();
  resizeObs = new ResizeObserver(measure);
  if (containerRef.value) {
    resizeObs.observe(containerRef.value);
    containerRef.value.addEventListener("transitionend", onTransitionEnd);
  }
  startRenderLoop();
});

onBeforeUnmount(() => {
  stopRenderLoop();
  resizeObs?.disconnect();
  resizeObs = null;
  containerRef.value?.removeEventListener("transitionend", onTransitionEnd);
});
</script>

<template>
  <div class="dl-line-block">
    <div ref="containerRef" class="dl-line" :style="lineStyle">
      <span ref="contentRef" class="dl-line-inner" :class="{ 'has-mask': backgroundMask }">
        <span class="dl-text">
          <template v-if="wordByWord">
            <span
              v-for="(word, i) in line.words"
              :key="i"
              :ref="(el) => setWordRef(el, i)"
              class="dl-word"
            >
              {{ word.word }}
            </span>
          </template>
          <span v-else class="dl-static" :class="{ 'is-unplayed': isNext }">
            {{ line.words.map((w) => w.word).join("") }}
          </span>
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
    transform var(--dl-anim, 0.6s) cubic-bezier(0.55, 0, 0.1, 1),
    opacity var(--dl-anim, 0.6s) cubic-bezier(0.55, 0, 0.1, 1);
  will-change: transform, opacity;
}
.dl-line {
  position: relative;
  width: 100%;
  line-height: normal;
  padding: 4px 0;
  overflow: hidden;
  white-space: nowrap;
  transition: font-size var(--dl-anim, 0.6s) cubic-bezier(0.55, 0, 0.1, 1);
}
.dl-line-inner {
  display: inline-block;
  will-change: transform;
}
.dl-line-inner.has-mask {
  line-height: 1;
  padding: 0.25em 0.4em;
  border-radius: 6px;
  background-color: var(--dl-mask, transparent);
}
.dl-text {
  display: inline-block;
  filter: drop-shadow(0 0 1px var(--dl-stroke, transparent))
    drop-shadow(0 0 2px var(--dl-stroke, transparent));
}
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
  transition: color var(--dl-anim, 0.6s) cubic-bezier(0.55, 0, 0.1, 1);
}
.dl-static.is-unplayed {
  color: var(--dl-unplayed);
}
</style>
