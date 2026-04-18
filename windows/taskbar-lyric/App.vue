<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import type { TaskbarLyricSettings } from "@shared/types/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IconSkipBack from "~icons/lucide/skip-back";
import IconSkipForward from "~icons/lucide/skip-forward";
import IconPlay from "~icons/lucide/play";
import IconPause from "~icons/lucide/pause";
import TaskbarLyricLine from "./components/TaskbarLyricLine.vue";
import { useNowPlayingSync } from "./composables/useNowPlayingSync";

const config = reactive<TaskbarLyricSettings>({
  position: "auto",
  autoMaxWidth: true,
  maxWidth: 400,
  colorMode: "taskbar",
  doubleLine: true,
  showTranslation: true,
  showCover: true,
  wordByWord: true,
  fontSize: 14,
});

const anchor = ref<"left" | "right">("left");
const taskbarIsLight = ref(false);
const isHovered = ref(false);

const { track, lyric, primaryIndex, playing } = useNowPlayingSync();

const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

const hasLyric = computed(() => lyric.value.length > 0 && primaryIndex.value >= 0);

const titleText = computed<string>(() => track.value?.title ?? "SPlayer");
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") || "未知艺术家",
);

const effectiveTheme = computed<"light" | "dark">(() => {
  if (config.colorMode === "light") return "light";
  if (config.colorMode === "dark") return "dark";
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

const rootStyle = computed(() => ({ "--tbl-font-size": `${config.fontSize}px` }));

const handlePrev = (e: MouseEvent): void => {
  e.stopPropagation();
  window.api.player.dispatch("prev");
};
const handleNext = (e: MouseEvent): void => {
  e.stopPropagation();
  window.api.player.dispatch("next");
};
const handleTogglePlay = (e: MouseEvent): void => {
  e.stopPropagation();
  window.api.player.dispatch(playing.value ? "pause" : "play");
};

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const saved = (await window.api.config.get("taskbarLyric")) as TaskbarLyricSettings | null;
    if (saved) Object.assign(config, saved);
  } catch (error) {
    console.error("[taskbar-lyric] load config failed", error);
  }

  unsubscribers.push(
    window.api.taskbarLyric.onLayout((data) => {
      anchor.value = data.anchor;
      taskbarIsLight.value = data.isLight;
    }),
    window.api.taskbarLyric.onConfigChange((next) => {
      Object.assign(config, next);
    }),
  );
});

onBeforeUnmount(() => {
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div class="wrapper" :data-align="anchor">
    <div
      class="container"
      :class="{ 'is-hovered': isHovered }"
      :data-theme="effectiveTheme"
      :data-align="anchor"
      :style="rootStyle"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
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

      <!-- 控件：hover 时从 0fr 展开到内容宽度 -->
      <div class="controls-wrapper">
        <div class="controls-inner">
          <button class="control-btn" type="button" @click="handlePrev">
            <IconSkipBack class="control-icon" />
          </button>
          <button class="control-btn" type="button" @click="handleTogglePlay">
            <component :is="playing ? IconPause : IconPlay" class="control-icon-play" />
          </button>
          <button class="control-btn" type="button" @click="handleNext">
            <IconSkipForward class="control-icon" />
          </button>
        </div>
      </div>

      <!-- 文本区：歌词层 + 歌曲信息层（hover 交叉淡入淡出） -->
      <div class="lyric-area">
        <TransitionGroup tag="div" name="line" class="lyric-column">
          <div v-for="item in items" :key="item.key" class="lyric-line" :data-role="item.role">
            <TaskbarLyricLine
              :line="item.line"
              :text="item.text"
              :word-by-word="config.wordByWord && !!item.line"
              :anchor="anchor"
            />
          </div>
        </TransitionGroup>

        <div class="song-info">
          <div class="song-title">{{ titleText }}</div>
          <div v-if="config.doubleLine" class="song-artist">{{ artistsText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.wrapper {
  width: 100vw;
  height: 100vh;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  pointer-events: none;
}
.wrapper[data-align="right"] {
  justify-content: flex-end;
}
.container {
  /* 深色主题 */
  --tbl-text-primary: #ffffff;
  --tbl-text-secondary: rgba(255, 255, 255, 0.5);
  --tbl-hover-bg: rgba(78, 78, 78, 0.4);
  --tbl-played: var(--tbl-text-primary);
  --tbl-unplayed: var(--tbl-text-secondary);
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  border-radius: 8px;
  background: transparent;
  overflow: hidden;
  pointer-events: auto;
  color: var(--tbl-text-primary);
  transition: background 0.3s;
}
.container[data-align="right"] {
  flex-direction: row-reverse;
}
.container[data-theme="light"] {
  --tbl-text-primary: #1a1a1a;
  --tbl-text-secondary: rgba(0, 0, 0, 0.62);
  --tbl-hover-bg: rgba(255, 255, 255, 0.45);
}
.container:hover {
  background: var(--tbl-hover-bg);
}
/* 封面 */
.cover-wrapper {
  flex: 0 0 auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  padding: 4px;
  overflow: hidden;
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
}
.control-icon-play {
  width: 12px;
  height: 12px;
}

.lyric-area {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: 4px;
  position: relative;
  height: 100%;
  overflow: hidden;
}
.container[data-align="right"] .lyric-area {
  margin-left: 0;
  margin-right: 4px;
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
  transform: translateY(12px);
}
.line-leave-to {
  opacity: 0;
  transform: translateY(-12px);
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
  pointer-events: auto;
  transition-delay: 0.08s;
}
.song-title {
  font-size: var(--tbl-font-size);
  color: var(--tbl-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.song-artist {
  font-size: calc(var(--tbl-font-size) * 0.82);
  color: var(--tbl-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
