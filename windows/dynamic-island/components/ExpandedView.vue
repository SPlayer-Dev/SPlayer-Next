<script setup lang="ts">
/**
 * 灵动岛展开视图
 * 参照 WinIsland 的 music_view.rs：封面+信息同行、歌词右侧、进度条、控制按钮
 * 纯音乐时歌词区改为频谱（歌词区即频谱区），非纯音乐不显示频谱
 */
import type { Track } from "@shared/types/player";
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import IslandSpectrum from "./IslandSpectrum.vue";
import { extractPalette } from "../utils/palette";
import DEFAULT_COVER from "@/assets/images/song.jpg";

interface Props {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  config: DynamicIslandSettings;
  /** 当前行歌词（用于展开视图信息右侧显示） */
  currentLine?: LyricLine | null;
  /** 是否为纯音乐：true 时歌词区改为频谱 */
  isInstrumental?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  currentLine: null,
  isInstrumental: false,
});

const emit = defineEmits<{
  (e: "seek", positionMs: number): void;
  (e: "prev"): void;
  (e: "next"): void;
  (e: "toggle-play"): void;
  (e: "interact"): void;
}>();

const coverSize = computed(() => Math.round(56 * props.config.scale));
const PROGRESS_HEIGHT = 5;
const PROGRESS_HOVER_HEIGHT = 8;
/* 纯音乐模式频谱尺寸：展开视图有充足宽度，使用更大频谱 */
const INSTRUMENTAL_SPECTRUM_WIDTH = 280;
const INSTRUMENTAL_SPECTRUM_HEIGHT = 50;

const progressHovered = ref(false);
const isDragging = ref(false);
const progressRef = ref<HTMLElement | null>(null);

const formatTime = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const progressPercent = computed(() => {
  if (!props.duration) return 0;
  return Math.min(1, Math.max(0, props.position / props.duration));
});

const seekFromEvent = (event: MouseEvent): void => {
  const el = progressRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  emit("seek", ratio * props.duration);
};

const onProgressMouseDown = (event: MouseEvent): void => {
  isDragging.value = true;
  seekFromEvent(event);
  emit("interact");
};

const onProgressMouseMove = (event: MouseEvent): void => {
  if (!isDragging.value) return;
  seekFromEvent(event);
};

const onProgressMouseUp = (): void => {
  isDragging.value = false;
};

const handlePrev = (): void => {
  emit("prev");
  emit("interact");
};
const handleNext = (): void => {
  emit("next");
  emit("interact");
};
const handleTogglePlay = (): void => {
  emit("toggle-play");
  emit("interact");
};

const artistsText = computed(
  () => props.track?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/** 当前行文本（取 words 拼接，无歌词时显示歌曲名） */
const currentLyricText = computed(() => {
  const line = props.currentLine;
  if (!line || !line.words || line.words.length === 0) {
    return props.track?.title ?? "";
  }
  return line.words.map((w) => w.word).join("");
});

/** 歌词文本 ref，用于检测是否超出 2 行 */
const lyricTextRef = ref<HTMLElement | null>(null);
/** 歌词是否超出 2 行需要滚动 */
const isLyricScrollable = ref(false);

/** 检测歌词是否超出容器高度（2 行） */
const checkLyricScroll = (): void => {
  const el = lyricTextRef.value;
  if (!el) {
    isLyricScrollable.value = false;
    return;
  }
  // scrollHeight > clientHeight 表示内容超出可见区域
  isLyricScrollable.value = el.scrollHeight > el.clientHeight + 1;
};

watch(currentLyricText, () => {
  // 文本变化后下一帧检测，确保 DOM 已更新
  requestAnimationFrame(checkLyricScroll);
});

onMounted(() => {
  window.addEventListener("mouseup", onProgressMouseUp);
  window.addEventListener("mousemove", onProgressMouseMove);
  requestAnimationFrame(checkLyricScroll);
});

/* 频谱调色板（参照 WinIsland：从封面提取 primary/secondary/primary 渐变） */
const palette = ref<string[]>([
  "rgba(255, 255, 255, 0.9)",
  "rgba(255, 255, 255, 0.5)",
  "rgba(255, 255, 255, 0.9)",
]);

watch(
  () => props.track?.cover,
  async (cover) => {
    palette.value = await extractPalette(cover || DEFAULT_COVER);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("mouseup", onProgressMouseUp);
  window.removeEventListener("mousemove", onProgressMouseMove);
});
</script>

<template>
  <div class="expanded">
    <!-- 封面 + 信息 + 歌词/频谱（同一行） -->
    <div class="top-row">
      <div class="cover-frame" :style="{ width: `${coverSize}px`, height: `${coverSize}px` }">
        <img
          :src="track?.cover || DEFAULT_COVER"
          alt="cover"
          draggable="false"
          decoding="async"
          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
        />
      </div>
      <div class="info-lyric-row">
        <div class="info-area">
          <div class="song-title">{{ track?.title ?? "未知曲目" }}</div>
          <div class="song-artist">{{ artistsText || "未知艺术家" }}</div>
        </div>
        <!-- 纯音乐：歌词区改为大频谱 -->
        <IslandSpectrum
          v-if="isInstrumental && config.showSpectrum"
          :width="INSTRUMENTAL_SPECTRUM_WIDTH"
          :height="INSTRUMENTAL_SPECTRUM_HEIGHT"
          :max-height="INSTRUMENTAL_SPECTRUM_HEIGHT"
          :bar-width="4"
          :bar-gap="3"
          :num-bands="40"
          :palette="palette"
          :playing="playing"
          :spectrum-style="config.spectrumStyle"
          class="lyric-spectrum"
        />
        <!-- 非纯音乐：显示歌词（2 行，超出滚动） -->
        <div v-else ref="lyricTextRef" class="lyric-text" :class="{ scrollable: isLyricScrollable }">
          <span class="lyric-text-inner">{{ currentLyricText }}</span>
        </div>
      </div>
    </div>

    <!-- 进度条 -->
    <div
      ref="progressRef"
      class="progress-track"
      :style="{ height: `${progressHovered || isDragging ? PROGRESS_HOVER_HEIGHT : PROGRESS_HEIGHT}px` }"
      @mousedown="onProgressMouseDown"
      @mouseenter="progressHovered = true"
      @mouseleave="progressHovered = false"
    >
      <div class="progress-fill" :style="{ width: `${progressPercent * 100}%` }" />
    </div>

    <!-- 控制栏：时间 + 按钮 + 剩余时间 -->
    <div class="controls-area">
      <span class="time">{{ formatTime(position) }}</span>
      <div class="controls">
        <button class="ctrl-btn" type="button" @click="handlePrev">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
        </button>
        <button class="ctrl-btn ctrl-play" type="button" @click="handleTogglePlay">
          <svg v-if="playing" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button class="ctrl-btn" type="button" @click="handleNext">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
        </button>
      </div>
      <span class="time remaining">-{{ formatTime(duration - position) }}</span>
    </div>
  </div>
</template>

<style scoped>
.expanded {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  box-sizing: border-box;
  color: var(--di-played);
  gap: 10px;
  pointer-events: none;
}
.top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.cover-frame {
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
}
.cover-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.info-lyric-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.info-area {
  flex-shrink: 0;
  max-width: 45%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.song-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-artist {
  font-size: 11px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lyric-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  opacity: 0.85;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  padding-left: 12px;
  /* 默认 2 行显示，超出省略 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.lyric-text.scrollable {
  /* 超过 2 行时改为可滚动，取消 line-clamp */
  -webkit-line-clamp: unset;
  display: block;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}
.lyric-text.scrollable::-webkit-scrollbar {
  width: 3px;
}
.lyric-text.scrollable::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
.lyric-text-inner {
  display: block;
}
.lyric-spectrum {
  flex-shrink: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  padding-left: 12px;
}
.progress-track {
  width: 100%;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;
  transition: height 0.15s ease;
  overflow: hidden;
  pointer-events: auto;
}
.progress-fill {
  height: 100%;
  background: var(--di-played);
  border-radius: 4px;
  transition: width 0.1s linear;
}
.controls-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: auto;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--di-played);
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.2s, transform 0.15s;
}
.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.ctrl-btn:active {
  transform: scale(0.9);
}
.ctrl-play {
  width: 38px;
  height: 38px;
  background: rgba(255, 255, 255, 0.15);
}
.ctrl-play:hover {
  background: rgba(255, 255, 255, 0.22);
}
.time {
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  min-width: 32px;
}
.time.remaining {
  text-align: right;
}
</style>
