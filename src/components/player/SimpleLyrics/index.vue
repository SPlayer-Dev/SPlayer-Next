<script setup lang="ts">
import type { LyricLine, LyricWord } from "@/types/lyric";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 是否正在播放 */
    playing?: boolean;
    /** 激活行在容器中的对齐位置 0~1 */
    alignPosition?: number;
  }>(),
  {
    playing: false,
    alignPosition: 0.35,
  },
);

const emit = defineEmits<{
  (e: "seek", timeMs: number): void;
}>();

const containerRef = ref<HTMLDivElement>();
const activeIndex = ref(-1);
/** 当前播放时间（毫秒），驱动逐字高亮 */
const currentTime = ref(0);
/** 冻结标志 */
let frozen = false;
/** 用户手动滚动中 */
let userScrolling = false;
let scrollResetTimer = 0;

// 行元素引用
const lineRefs = ref<HTMLDivElement[]>([]);

const setLineRef = (el: any, i: number) => {
  if (el) lineRefs.value[i] = el as HTMLDivElement;
};

/** 查找当前激活行 */
const findActiveLine = (timeMs: number): number => {
  const lines = props.lyricLines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (timeMs >= lines[i].startTime) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
};

/** 滚动到激活行 */
const scrollToActive = (index: number) => {
  if (userScrolling || !containerRef.value || index < 0) return;
  const el = lineRefs.value[index];
  if (!el) return;

  const container = containerRef.value;
  const containerH = container.clientHeight;
  const targetOffset = el.offsetTop - containerH * props.alignPosition + el.offsetHeight / 2;

  container.scrollTo({
    top: Math.max(0, targetOffset),
    behavior: "smooth",
  });
};

/** 逐字进度百分比（0~100），用于 gradient 扫光 */
const wordPercent = (word: LyricWord, lineIdx: number): number => {
  if (lineIdx !== activeIndex.value) return 0;
  const t = currentTime.value;
  if (t <= word.startTime) return 0;
  if (t >= word.endTime) return 100;
  const duration = word.endTime - word.startTime;
  return duration > 0 ? ((t - word.startTime) / duration) * 100 : 100;
};

/** 外部调用：推送播放时间 */
const setCurrentTime = (time: number) => {
  if (frozen) return;
  currentTime.value = time;
  const idx = findActiveLine(time);
  if (idx !== activeIndex.value) {
    activeIndex.value = idx;
    scrollToActive(idx);
  }
};

const freeze = () => {
  frozen = true;
};
const resume = () => {
  frozen = false;
};

defineExpose({ setCurrentTime, freeze, resume });

/** 处理用户滚动 */
const onWheel = () => {
  userScrolling = true;
  clearTimeout(scrollResetTimer);
  scrollResetTimer = window.setTimeout(() => {
    userScrolling = false;
    scrollToActive(activeIndex.value);
  }, 5000);
};

/** 触摸滚动 */
let lastTouchY = 0;
const onTouchStart = (e: TouchEvent) => {
  lastTouchY = e.touches[0].clientY;
  userScrolling = true;
  clearTimeout(scrollResetTimer);
};
const onTouchMove = (e: TouchEvent) => {
  if (!containerRef.value) return;
  const dy = lastTouchY - e.touches[0].clientY;
  lastTouchY = e.touches[0].clientY;
  containerRef.value.scrollTop += dy;
};
const onTouchEnd = () => {
  scrollResetTimer = window.setTimeout(() => {
    userScrolling = false;
    scrollToActive(activeIndex.value);
  }, 5000);
};

/** 点击歌词行跳转 */
const onLineClick = (line: LyricLine) => {
  emit("seek", line.startTime);
};

/** 歌词变化时重置 */
watch(
  () => props.lyricLines,
  () => {
    activeIndex.value = -1;
    currentTime.value = 0;
    lineRefs.value = [];
    if (containerRef.value) {
      containerRef.value.scrollTop = 0;
    }
  },
);

onUnmounted(() => {
  clearTimeout(scrollResetTimer);
});
</script>

<template>
  <div
    ref="containerRef"
    class="simple-lyrics"
    @wheel.passive="onWheel"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <!-- 顶部留白 -->
    <div class="simple-lyrics-spacer" :style="{ height: `${alignPosition * 100}%` }" />

    <div
      v-for="(line, i) in lyricLines"
      :key="i"
      :ref="(el) => setLineRef(el, i)"
      class="simple-lyrics-line"
      :class="{
        active: i === activeIndex,
        passed: i < activeIndex,
        duet: line.isDuet,
        bg: line.isBG,
      }"
      @click="onLineClick(line)"
    >
      <!-- 主歌词：逐字扫光 -->
      <div class="simple-lyrics-main">
        <span
          v-for="(word, wi) in line.words"
          :key="wi"
          class="simple-lyrics-word"
          :style="
            i === activeIndex
              ? { '--p': `${wordPercent(word, i)}%` }
              : undefined
          "
        >{{ word.word }}</span>
      </div>
      <!-- 翻译 -->
      <div v-if="line.translatedLyric" class="simple-lyrics-sub">
        {{ line.translatedLyric }}
      </div>
      <!-- 音译 -->
      <div v-if="line.romanLyric" class="simple-lyrics-sub">
        {{ line.romanLyric }}
      </div>
    </div>

    <!-- 底部留白 -->
    <div class="simple-lyrics-spacer" :style="{ height: `${(1 - alignPosition) * 100}%` }" />
  </div>
</template>

<style scoped>
.simple-lyrics {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.simple-lyrics::-webkit-scrollbar {
  display: none;
}

.simple-lyrics-spacer {
  pointer-events: none;
  flex-shrink: 0;
}

.simple-lyrics-line {
  padding: 0.4em 1em;
  color: var(--lp-color, #fff);
  font-size: inherit;
  font-weight: inherit;
  opacity: 0.3;
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
  transform: scale(1);
  transform-origin: left center;
  cursor: pointer;
}

.simple-lyrics-line.active {
  opacity: 1;
  transform: scale(1.05);
}

.simple-lyrics-line.passed {
  opacity: 0.2;
}

.simple-lyrics-line.bg {
  font-size: 0.75em;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.simple-lyrics-line.bg.active {
  opacity: 0.4;
}

.simple-lyrics-line.duet {
  text-align: right;
  transform-origin: right center;
}

.simple-lyrics-main {
  word-break: normal;
  overflow-wrap: break-word;
}

/* ---- 逐字扫光（gradient + background-clip） ---- */

.simple-lyrics-word {
  --p: 0%;
  display: inline;
  white-space: pre-wrap;
  color: transparent;
  background: linear-gradient(
    90deg,
    var(--lp-color, #fff) var(--p),
    color-mix(in srgb, var(--lp-color, #fff) 30%, transparent) var(--p)
  );
  -webkit-background-clip: text;
  background-clip: text;
}

/* 非激活行：不需要渐变，直接用普通颜色继承行透明度 */
.simple-lyrics-line:not(.active) .simple-lyrics-word {
  color: inherit;
  background: none;
}

.simple-lyrics-sub {
  font-size: max(0.5em, 10px);
  line-height: 1.5em;
  opacity: 0.5;
}

/* 悬停效果 */
@media (hover: hover) and (pointer: fine) {
  .simple-lyrics-line:not(.bg):hover {
    opacity: 0.6;
  }
  .simple-lyrics-line.active:hover {
    opacity: 1;
  }
}
</style>
