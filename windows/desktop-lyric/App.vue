<script setup lang="ts">
import { TransitionGroup } from "vue";
import type { DesktopLyricSettings } from "@shared/types/settings";
import LyricLine from "./components/LyricLine.vue";
import {
  makePlaceholderLine,
  getLineTop,
  computeWindowHeight,
  resolveAlign,
  resolveWordByWord,
  type DisplayItem,
} from "./utils";
import { pickPrimaryIndex } from "@shared/utils/lyricSync";
import { useNowPlayingSync } from "@windows/shared/composables/useNowPlayingSync";
import { useDragWindow } from "./composables/useDragWindow";
import { useHoverState } from "./composables/useHoverState";

const config = reactive<DesktopLyricSettings>({
  fontSize: 24,
  fontWeight: 600,
  fontFamily: "",
  showTranslation: true,
  doubleLine: true,
  align: "center",
  wordByWord: true,
  autoGenerateWordByWord: true,
  playedColor: "#ffffff",
  unplayedColor: "#7d7d7d",
  strokeColor: "rgba(0, 0, 0, 0.5)",
  backgroundMask: false,
  backgroundMaskColor: "rgba(0, 0, 0, 0.3)",
  alwaysShowSongInfo: false,
  limitBounds: false,
  animation: true,
  alwaysOnTop: true,
  locked: false,
});

const { track, lyric, playing, primaryIndex } = useNowPlayingSync({
  pickIndex: pickPrimaryIndex,
  logTag: "desktop-lyric",
});
const { onRootPointerDown } = useDragWindow(() => config.locked);
const { isHovered } = useHoverState();

/** 
 * 占位行
 * @param key - 唯一键
 * @param mainText - 主行文本
 * @param subText - 副行文本（可选）
 * @returns 显示项数组
 */
const placeholder = (key: string, mainText: string, subText?: string): DisplayItem[] => {
  const align = config.align === "justify" ? "center" : config.align;
  const items: DisplayItem[] = [
    {
      key,
      index: -1,
      line: makePlaceholderLine(mainText),
      align,
      isPlaceholder: true,
    },
  ];
  if (config.doubleLine && subText) {
    items.push({
      key: `${key}-sub`,
      index: -1,
      line: makePlaceholderLine(subText),
      align,
      isPlaceholder: true,
      isNext: true,
    });
  }
  return items;
};

/** 艺术家显示文本 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/** 实际渲染的歌词列表 */
const displayItems = computed<DisplayItem[]>(() => {
  const lines = lyric.value;
  const cur = track.value;
  // 无曲目
  if (!cur) return placeholder("ph-idle", "SPlayer Desktop Lyric");
  // 占位歌曲信息
  const trackKey = cur.id ?? cur.title;
  const subText = artistsText.value || undefined;
  if (lines.length === 0) {
    return placeholder(`ph-meta-${trackKey}`, cur.title, subText);
  }
  // 获取当前主行索引
  const primary = primaryIndex.value;
  if (primary < 0) {
    return placeholder(`ph-title-${trackKey}`, cur.title, subText);
  }
  // 显示主行
  const items: DisplayItem[] = [
    {
      key: `m-${primary}`,
      index: primary,
      line: lines[primary],
      align: resolveAlign(primary, config.align),
    },
  ];
  // 显示翻译行
  const current = lines[primary];
  if (config.showTranslation && current.translatedLyric) {
    items.push({
      key: `t-${primary}`,
      index: primary,
      line: makePlaceholderLine(current.translatedLyric),
      align: resolveAlign(primary, config.align),
      isPlaceholder: true,
      isNext: true,
    });
    return items;
  }
  // 显示下一句
  if (config.doubleLine) {
    const nextIdx = primary + 1;
    if (nextIdx < lines.length) {
      items.push({
        key: `m-${nextIdx}`,
        index: nextIdx,
        line: lines[nextIdx],
        align: resolveAlign(nextIdx, config.align),
        isNext: true,
      });
    }
  }
  return items;
});

/** 根节点 CSS 变量 */
const rootStyle = computed(() => ({
  "--dl-played": config.playedColor,
  "--dl-unplayed": config.unplayedColor,
  "--dl-stroke": config.strokeColor,
  "--dl-mask": config.backgroundMaskColor,
  // 行位置 / 字号 / 颜色的过渡时长，关动画时置 0 让所有后代 transition 变瞬时
  "--dl-anim": config.animation ? "0.6s" : "0s",
  fontFamily: config.fontFamily || undefined,
}));

/** 常驻信息文字对齐 */
const persistentTextAlign = computed<"left" | "center" | "right">(() =>
  config.align === "justify" ? "center" : config.align,
);

/** 窗口高度锁定到当前字号对应值 */
const pushWindowHeight = (): void => {
  const target = computeWindowHeight(config.fontSize);
  window.api.desktopLyric.setHeight(target).catch((error) => {
    console.error("[desktop-lyric] setHeight failed", error);
  });
};

// 监听字体大小变化，更新窗口高度
watch(() => config.fontSize, pushWindowHeight);

/** 顶栏按钮 */
const onHeaderAction = (
  action:
    | "focus-main"
    | "prev"
    | "next"
    | "toggle-play"
    | "open-settings"
    | "toggle-locked"
    | "close",
): void => {
  switch (action) {
    case "focus-main":
      window.api.system.focusMainWindow().catch(() => {});
      break;
    case "prev":
    case "next":
      window.api.player.dispatch(action);
      break;
    case "toggle-play":
      window.api.player.dispatch(playing.value ? "pause" : "play");
      break;
    case "open-settings":
      window.api.system.openSettings("externalLyric", "desktopLyricEnabled").catch(() => {});
      break;
    case "toggle-locked":
      window.api.config.set("desktopLyric.locked", !config.locked).catch(() => {});
      break;
    case "close":
      window.api.window.closeDesktopLyric().catch(() => {});
      break;
  }
};

// 锁定按钮鼠标进入事件：临时放开穿透以允许点击
const onLockBtnEnter = (): void => {
  if (config.locked) window.api.desktopLyric.setMouseIgnore(false);
};

// 锁定按钮鼠标离开事件：恢复穿透
const onLockBtnLeave = (): void => {
  if (config.locked) window.api.desktopLyric.setMouseIgnore(true);
};

/** 配置变更订阅取消器 */
let unsubConfig: (() => void) | null = null;

onMounted(async () => {
  try {
    const saved = await window.api.config.get("desktopLyric");
    Object.assign(config, saved as DesktopLyricSettings);
  } catch (error) {
    console.error("[desktop-lyric] load config failed", error);
  }
  pushWindowHeight();
  unsubConfig = window.api.desktopLyric.onConfigChange((next) => Object.assign(config, next));
});

onBeforeUnmount(() => {
  unsubConfig?.();
  unsubConfig = null;
});
</script>

<template>
  <div
    class="root"
    :class="{ hovered: isHovered, locked: config.locked }"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <div
      v-if="track && config.alwaysShowSongInfo"
      class="persistent-info"
      :class="{ hidden: isHovered }"
      :style="{ textAlign: persistentTextAlign }"
    >
      <div class="info-box" :class="{ 'has-mask': config.backgroundMask }">
        <div class="name">{{ track.title }}</div>
        <div v-if="artistsText" class="artist">{{ artistsText }}</div>
      </div>
    </div>
    <div class="header">
      <div class="header-section header-left">
        <button
          class="header-btn logo-btn"
          :title="track?.title ?? '回到主窗口'"
          @click="onHeaderAction('focus-main')"
        >
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path
              class="logo-primary"
              d="M511.764091 131.708086a446.145957 446.145957 0 1 0 446.145957 446.145957 446.145957 446.145957 0 0 0-446.145957-446.145957z m0 519.76004A71.829499 71.829499 0 1 1 583.59359 580.530919 72.275645 72.275645 0 0 1 511.764091 651.468126z"
            />
            <path
              class="logo-secondary"
              d="M802.205109 0.541175l-168.197026 37.030114a67.814185 67.814185 0 0 0-53.091369 66.029602V223.614153l3.569168 349.778431h114.213365V223.614153h108.859613a26.322611 26.322611 0 0 0 26.768758-26.322611V26.863786a26.768757 26.768757 0 0 0-32.122509-26.322611z"
            />
            <path
              class="logo-secondary"
              d="M511.764091 386.457428a186.935156 186.935156 0 1 0 186.935156 186.48901A186.935156 186.935156 0 0 0 511.764091 386.457428z m0 264.564552a71.383353 71.383353 0 1 1 71.383353-71.383353 71.383353 71.383353 0 0 1-71.383353 71.383353z"
            />
          </svg>
        </button>
        <div class="song-info">
          <div class="song-title">{{ track?.title ?? "SPlayer Desktop Lyric" }}</div>
          <div v-if="track" class="song-artist">{{ artistsText || "未知艺术家" }}</div>
        </div>
      </div>
      <div class="header-section header-center">
        <button class="header-btn" title="上一曲" @click="onHeaderAction('prev')">
          <IconLucideSkipBack />
        </button>
        <button
          class="header-btn"
          :title="playing ? '暂停' : '播放'"
          @click="onHeaderAction('toggle-play')"
        >
          <IconLucidePause v-if="playing" />
          <IconLucidePlay v-else />
        </button>
        <button class="header-btn" title="下一曲" @click="onHeaderAction('next')">
          <IconLucideSkipForward />
        </button>
      </div>
      <div class="header-section header-right">
        <button class="header-btn" title="设置" @click="onHeaderAction('open-settings')">
          <IconLucideSettings />
        </button>
        <button
          class="header-btn lock-btn"
          :title="config.locked ? '解锁窗口' : '锁定窗口'"
          @click="onHeaderAction('toggle-locked')"
          @mouseenter="onLockBtnEnter"
          @mouseleave="onLockBtnLeave"
        >
          <IconLucideUnlock v-if="config.locked" />
          <IconLucideLock v-else />
        </button>
        <button class="header-btn" title="关闭桌面歌词" @click="onHeaderAction('close')">
          <IconLucideX />
        </button>
      </div>
    </div>
    <component
      :is="config.animation ? TransitionGroup : 'div'"
      tag="div"
      name="dl-line"
      class="stage"
    >
      <LyricLine
        v-for="(item, index) in displayItems"
        :key="item.key"
        :line="item.line"
        :font-size="item.isNext ? Math.round(config.fontSize * 0.8) : config.fontSize"
        :font-weight="config.fontWeight"
        :align="item.align"
        :word-by-word="resolveWordByWord(config, item)"
        :is-next="!!item.isNext"
        :background-mask="config.backgroundMask"
        :style="{
          '--dl-y': getLineTop(index, config.fontSize),
        }"
      />
    </component>
  </div>
</template>

<style scoped>
.root {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--dl-played);
  box-sizing: border-box;
  border-radius: 12px;
  background: transparent;
  cursor: move;
  transition: background-color 0.2s ease;
}
.root.locked {
  cursor: default;
}
.root.hovered:not(.locked) {
  background: rgba(0, 0, 0, 0.5);
}
.header {
  flex: 0 0 56px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 12px;
  box-sizing: border-box;
  color: #fff;
}
.header-btn,
.song-info {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.root.hovered:not(.locked) .header-btn,
.root.hovered:not(.locked) .song-info {
  opacity: 1;
}
.root.locked.hovered .lock-btn {
  opacity: 1;
}
.root.locked.hovered .lock-btn :deep(svg) {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
.persistent-info {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  line-height: 56px;
  padding: 0 24px;
  box-sizing: border-box;
  color: #fff;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.2s ease;
}
.persistent-info.hidden {
  opacity: 0;
}
.info-box {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  min-width: 0;
  line-height: 1.2;
}
.info-box.has-mask {
  padding: 4px 10px;
  border-radius: 6px;
  background-color: var(--dl-mask, transparent);
}
.info-box .name,
.info-box .artist {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}
.info-box .name {
  font-size: 14px;
  font-weight: 500;
}
.info-box .artist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.header-section {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.header-left {
  justify-content: flex-start;
}
.header-center {
  justify-content: center;
}
.header-right {
  justify-content: flex-end;
}
.header-btn {
  width: 36px;
  min-width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font: inherit;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    background-color 0.15s;
}
.header-btn :deep(svg) {
  width: 20px;
  height: 20px;
}
.header-btn:hover {
  background-color: rgba(255, 255, 255, 0.2);
}
.logo-btn :deep(svg) {
  width: 24px;
  height: 24px;
}
.logo-btn :deep(.logo-primary),
.logo-btn :deep(.logo-secondary) {
  fill: currentColor;
  transition:
    fill 0.25s ease,
    fill-opacity 0.25s ease;
}
.logo-btn :deep(.logo-primary) {
  fill-opacity: 0.3;
}
.logo-btn:hover :deep(.logo-primary) {
  fill: #f55e55;
  fill-opacity: 1;
}
.logo-btn:hover :deep(.logo-secondary) {
  fill: #f9bbb8;
}
.header-btn:active {
  background-color: rgba(255, 255, 255, 0.3);
}
.song-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.3;
  overflow: hidden;
}
.song-title {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-artist {
  font-size: 11px;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  position: relative;
  pointer-events: none;
}
.dl-line-enter-from {
  opacity: 0;
  transform: translate3d(0, var(--dl-y, 0px), 0) translateY(100%);
}
.dl-line-leave-to {
  opacity: 0;
  transform: translate3d(0, var(--dl-y, 0px), 0) translateY(-100%);
}
</style>
