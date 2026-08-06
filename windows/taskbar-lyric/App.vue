<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { TaskbarLyricSettings } from "@shared/types/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IconSkipBack from "~icons/lucide/skip-back";
import IconSkipForward from "~icons/lucide/skip-forward";
import IconPlay from "~icons/lucide/play";
import IconPause from "~icons/lucide/pause";
import TaskbarLyricLine from "./components/TaskbarLyricLine.vue";
import { pickPrimaryIndex } from "@shared/utils/lyricSync";
import { useNowPlayingSync } from "@windows/shared/composables/useNowPlayingSync";
import { formatArtists } from "@shared/utils/track";

const config = reactive<TaskbarLyricSettings>({
  position: "auto",
  autoMaxWidth: true,
  autoAdjustOccupiedSpace: false,
  maxWidth: 400,
  leftMargin: 0,
  rightMargin: 0,
  colorMode: "taskbar",
  showBackground: false,
  doubleLine: true,
  showTranslation: true,
  showCover: true,
  wordByWord: true,
  fontSize: 14,
  fontWeight: 400,
  fontFamily: "",
});

const anchor = ref<"left" | "right">("left");
const taskbarIsLight = ref(false);
const isHovered = ref(false);
const maxLayoutWidth = ref(400);
const wrapperRef = ref<HTMLElement | null>(null);
let hoverLeaveTimer: number | null = null;
let widthReportRaf = 0;
let lastReportedWidth = 0;

/** 给字体亚像素取整和逐字渐变预留空间，避免临界宽度误触发滚动 */
const LYRIC_WIDTH_GUARD = 8;

/** 按歌词行动画结束后的字号换算文字宽度，避免副行升为主行时低估空间 */
const measureTargetTextWidth = (element: HTMLElement): number => {
  const line = element.closest<HTMLElement>(".lyric-line");
  if (!line) return element.scrollWidth;

  const currentFontSize = Number.parseFloat(getComputedStyle(line).fontSize);
  const targetFontSize =
    line.dataset.role === "secondary" ? config.fontSize * 0.82 : config.fontSize;
  if (!Number.isFinite(currentFontSize) || currentFontSize <= 0) return element.scrollWidth;
  return element.scrollWidth * (targetFontSize / currentFontSize);
};

/** 测量当前内容的自然宽度，不受已经收窄的窗口反向限制 */
const reportContentWidth = (): void => {
  widthReportRaf = 0;
  const wrapper = wrapperRef.value;
  if (!wrapper) return;
  if (isHovered.value) {
    const targetWidth = Math.ceil(maxLayoutWidth.value);
    if (targetWidth === lastReportedWidth) return;
    lastReportedWidth = targetWidth;
    window.api.taskbarLyric.setContentWidth(targetWidth);
    return;
  }

  const wrapperStyle = getComputedStyle(wrapper);
  const horizontalPadding =
    Number.parseFloat(wrapperStyle.paddingLeft) + Number.parseFloat(wrapperStyle.paddingRight);
  const coverWidth = config.showCover
    ? (wrapper.querySelector<HTMLElement>(".cover-wrapper")?.offsetWidth ?? 0)
    : 0;
  const lyricArea = wrapper.querySelector<HTMLElement>(".lyric-area");
  const lyricStyle = lyricArea ? getComputedStyle(lyricArea) : null;
  const lyricMargins = lyricStyle
    ? Number.parseFloat(lyricStyle.marginLeft) + Number.parseFloat(lyricStyle.marginRight)
    : 0;
  const textElements = wrapper.querySelectorAll<HTMLElement>(".lyric-line .scroll-content");
  const naturalTextWidth = Math.max(0, ...Array.from(textElements, measureTargetTextWidth));
  const fixedWidth = horizontalPadding + coverWidth + lyricMargins;
  const availableTextWidth = Math.max(0, maxLayoutWidth.value - fixedWidth);
  const preferredTextWidth = naturalTextWidth + LYRIC_WIDTH_GUARD;
  const textWidth = Math.min(preferredTextWidth, availableTextWidth);
  const targetWidth = Math.ceil(Math.min(maxLayoutWidth.value, fixedWidth + textWidth));
  if (targetWidth === lastReportedWidth) return;
  lastReportedWidth = targetWidth;
  window.api.taskbarLyric.setContentWidth(targetWidth);
};

const scheduleContentWidthReport = (): void => {
  if (widthReportRaf) return;
  widthReportRaf = requestAnimationFrame(reportContentWidth);
};

const setContentHovered = (hovered: boolean): void => {
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = null;
  }
  if (hovered) {
    isHovered.value = true;
    nextTick(scheduleContentWidthReport);
    return;
  }
  hoverLeaveTimer = window.setTimeout(() => {
    hoverLeaveTimer = null;
    isHovered.value = false;
    nextTick(scheduleContentWidthReport);
  }, 40);
};

const { track, lyric, primaryIndex, playing } = useNowPlayingSync({
  pickIndex: pickPrimaryIndex,
  logTag: "taskbar-lyric",
});

const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

const hasLyric = computed(() => lyric.value.length > 0 && primaryIndex.value >= 0);

const titleText = computed<string>(() => track.value?.title ?? "SPlayer Next");
const artistsText = computed<string>(() => formatArtists(track.value?.artists) || "未知艺术家");

const effectiveTheme = computed<"light" | "dark">(() => {
  if (config.colorMode === "light") return "light";
  if (config.colorMode === "dark") return "dark";
  if (config.colorMode === "taskbarInverse") return taskbarIsLight.value ? "dark" : "light";
  return taskbarIsLight.value ? "light" : "dark";
});

interface RenderItem {
  key: string;
  role: "primary" | "secondary";
  text: string;
  line?: LyricLine;
}

const items = computed<RenderItem[]>(() => {
  if (hasLyric.value) {
    const idx = primaryIndex.value;
    const line = currentLine.value!;
    const list: RenderItem[] = [
      {
        key: `line-${idx}`,
        role: "primary",
        text: line.words.map((w) => w.word).join(""),
        line,
      },
    ];
    if (config.doubleLine) {
      const trans = config.showTranslation ? line.translatedLyric : "";
      if (trans) {
        list.push({ key: `trans-${idx}`, role: "secondary", text: trans });
      } else {
        const next = lyric.value[idx + 1];
        if (next) {
          list.push({
            key: `line-${idx + 1}`,
            role: "secondary",
            text: next.words.map((w) => w.word).join(""),
            line: next,
          });
        }
      }
    }
    return list;
  }
  /* 无歌词：歌曲信息填在主/副行 */
  const list: RenderItem[] = [{ key: "meta-title", role: "primary", text: titleText.value }];
  if (config.doubleLine) {
    list.push({ key: "meta-artist", role: "secondary", text: artistsText.value });
  }
  return list;
});

const rootStyle = computed(() => ({
  "--tbl-font-size": `${config.fontSize}px`,
  fontWeight: config.fontWeight,
  fontFamily: config.fontFamily || undefined,
}));

const handlePrev = (): void => window.api.player.dispatch("prev");
const handleNext = (): void => window.api.player.dispatch("next");
const handleTogglePlay = (): void => window.api.player.dispatch(playing.value ? "pause" : "play");
const handleFocusMain = (): void => {
  window.api.system.focusMainWindow().catch(() => {});
};

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const saved = (await window.api.config.get("taskbarLyric")) as TaskbarLyricSettings | null;
    if (saved) Object.assign(config, saved);
    await nextTick();
    scheduleContentWidthReport();
  } catch (error) {
    console.error("[taskbar-lyric] load config failed", error);
  }

  unsubscribers.push(
    window.api.taskbarLyric.onLayout((data) => {
      anchor.value = data.anchor;
      taskbarIsLight.value = data.isLight;
      maxLayoutWidth.value = data.maxWidth;
      nextTick(scheduleContentWidthReport);
    }),
    window.api.taskbarLyric.onConfigChange((next) => {
      Object.assign(config, next);
      nextTick(scheduleContentWidthReport);
    }),
  );
});

watch(items, () => nextTick(scheduleContentWidthReport));
watch(
  () => [
    config.showCover,
    config.doubleLine,
    config.fontSize,
    config.fontWeight,
    config.fontFamily,
  ],
  () => nextTick(scheduleContentWidthReport),
);

onBeforeUnmount(() => {
  if (widthReportRaf) cancelAnimationFrame(widthReportRaf);
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = null;
  }
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="wrapper"
    :data-align="anchor"
    @mouseenter="setContentHovered(true)"
    @mouseleave="setContentHovered(false)"
  >
    <div
      class="container"
      :class="{ 'is-hovered': isHovered, 'shows-background': config.showBackground }"
      :data-theme="effectiveTheme"
      :data-align="anchor"
      :style="rootStyle"
      @dblclick="handleFocusMain"
    >
      <div v-if="config.showCover" class="cover-wrapper">
        <img
          class="cover"
          :src="track?.cover || DEFAULT_COVER"
          alt=""
          draggable="false"
          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
        />
      </div>

      <!-- 播放控件 -->
      <div class="controls-wrapper">
        <div class="controls-inner">
          <button class="control-btn" type="button" @click.stop="handlePrev" @dblclick.stop>
            <IconSkipBack class="control-icon" />
          </button>
          <button class="control-btn" type="button" @click.stop="handleTogglePlay" @dblclick.stop>
            <component :is="playing ? IconPause : IconPlay" class="control-icon" />
          </button>
          <button class="control-btn" type="button" @click.stop="handleNext" @dblclick.stop>
            <IconSkipForward class="control-icon" />
          </button>
        </div>
      </div>

      <!-- 文本区 -->
      <div class="lyric-area">
        <!-- 歌词层 -->
        <TransitionGroup
          tag="div"
          name="line"
          class="lyric-column"
          @after-leave="scheduleContentWidthReport"
        >
          <div v-for="item in items" :key="item.key" class="lyric-line" :data-role="item.role">
            <TaskbarLyricLine
              :line="item.line"
              :text="item.text"
              :word-by-word="config.wordByWord && !!item.line"
              :anchor="anchor"
            />
          </div>
        </TransitionGroup>
        <!-- 歌曲信息 -->
        <div class="song-info">
          <div class="song-title">
            {{ titleText }}
          </div>
          <div v-if="config.doubleLine" class="song-artist">
            {{ artistsText }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.wrapper {
  width: 100vw;
  height: 100vh;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  pointer-events: auto;
}
.wrapper[data-align="right"] {
  justify-content: flex-end;
}
.container {
  /* 深色主题 */
  --tbl-text-primary: #ffffff;
  --tbl-text-secondary: rgba(255, 255, 255, 0.5);
  --tbl-hover-bg: rgba(255, 255, 255, 0.12);
  --tbl-played: var(--tbl-text-primary);
  --tbl-unplayed: var(--tbl-text-secondary);
  position: relative;
  width: 100%;
  height: calc(100% - 8px);
  display: flex;
  align-items: center;
  border-radius: 8px;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
  color: var(--tbl-text-primary);
  transition: background 0.3s;
}
.container[data-align="right"] {
  flex-direction: row-reverse;
}
.container[data-theme="light"] {
  --tbl-text-primary: #1a1a1a;
  --tbl-text-secondary: rgba(0, 0, 0, 0.62);
  --tbl-hover-bg: rgba(0, 0, 0, 0.08);
}
.container.shows-background.is-hovered {
  background: var(--tbl-hover-bg);
}
/* 封面 */
.cover-wrapper {
  flex: 0 0 auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  padding: 4px;
  overflow: hidden;
  pointer-events: auto;
}
.cover {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
  display: block;
}
.controls-wrapper {
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  max-width: 0;
  overflow: hidden;
  pointer-events: none;
  transition: max-width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
.controls-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.container.is-hovered .controls-wrapper {
  max-width: calc(3 * (100vh - 16px) + 16px);
  pointer-events: auto;
}
.container.is-hovered .controls-inner {
  opacity: 1;
  transition-delay: 0.1s;
}
.control-btn {
  flex: 0 0 auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 6px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--tbl-text-primary) 24%, transparent);
  color: var(--tbl-text-primary);
  cursor: pointer;
  transition:
    background 0.3s,
    transform 0.3s;
}
.control-btn:hover {
  background: color-mix(in srgb, var(--tbl-text-primary) 16%, transparent);
}
.control-btn:active {
  transform: scale(0.9);
}
.control-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.3s;
}

.lyric-area {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 4px;
  position: relative;
  height: 100%;
  overflow: hidden;
}

.lyric-column {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  opacity: 1;
  transition: opacity 0.18s ease;
}
.container[data-align="right"] .lyric-column {
  align-items: flex-end;
}
.container.is-hovered .lyric-column {
  opacity: 0;
  pointer-events: none;
}

.lyric-line {
  width: 100%;
  transform-origin: left center;
  transition:
    font-size 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.3s ease;
  will-change: transform, opacity;
}
.container[data-align="right"] .lyric-line {
  transform-origin: right center;
}
.lyric-line[data-role="primary"] {
  font-size: var(--tbl-font-size);
  color: var(--tbl-text-primary);
}
.lyric-line[data-role="secondary"] {
  font-size: calc(var(--tbl-font-size) * 0.82);
  color: var(--tbl-text-secondary);
}

.line-move,
.line-enter-active,
.line-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    font-size 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.3s ease;
}
.line-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}
.line-enter-from {
  opacity: 0;
  transform: translateY(100%);
}
.line-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

.song-info {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
.container[data-align="right"] .song-info {
  align-items: flex-end;
}
.container.is-hovered .song-info {
  opacity: 1;
  transition-delay: 0.08s;
}
.song-title {
  width: fit-content;
  font-size: var(--tbl-font-size);
  color: var(--tbl-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  pointer-events: auto;
}
.song-artist {
  width: fit-content;
  font-size: calc(var(--tbl-font-size) * 0.82);
  color: var(--tbl-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  pointer-events: auto;
}
</style>
