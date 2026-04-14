<script setup lang="ts">
import type { NowPlayingSnapshot, NowPlayingPositionSync } from "@shared/types/nowPlaying";
import type { LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import type { DesktopLyricSettings } from "@shared/types/settings";
import LyricLineView from "./components/LyricLine.vue";
import {
  pickPrimaryIndex,
  makePlaceholderLine,
  getLineTop,
  computeWindowHeight,
  resolveAlign,
  resolveWordByWord,
  clampLastLineEnd,
  type DisplayItem,
} from "./utils";

const config = reactive<DesktopLyricSettings>({
  fontSize: 24,
  fontWeight: 600,
  showTranslation: true,
  doubleLine: true,
  align: "center",
  wordByWord: true,
  autoGenerateWordByWord: true,
  playedColor: "#ffffff",
  unplayedColor: "#7d7d7d",
  alwaysOnTop: true,
  locked: false,
});

/** 当前播放的曲目 */
const track = shallowRef<Track | null>(null);
/** 当前歌词数组 */
const lyric = shallowRef<LyricLine[]>([]);
/** 是否正在播放 */
const playing = ref(false);
/** 当前毫秒游标 */
const currentMs = ref(0);
/** 当前行索引 */
const primaryIndex = ref(-1);

/** 锚点播放位置（ms） */
let anchorPos = 0;
/** 锚点对应的 performance.now() 时刻 */
let anchorPerf = 0;

/** 占位行 */
const placeholder = (key: string, text: string): DisplayItem[] => [
  {
    key,
    index: -1,
    line: makePlaceholderLine(text),
    align: config.align === "justify" ? "center" : config.align,
    isPlaceholder: true,
  },
];

/** 艺术家 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/** 实际渲染的歌词列表 */
const displayItems = computed<DisplayItem[]>(() => {
  const lines = lyric.value;
  const cur = track.value;

  if (!cur) return placeholder("ph-idle", "SPlayer Desktop Lyric");
  if (lines.length === 0) return placeholder("ph-inst", "纯音乐，请欣赏");

  const primary = primaryIndex.value;
  if (primary < 0) {
    return placeholder(`ph-title-${cur.id ?? cur.title}`, cur.title);
  }

  const items: DisplayItem[] = [
    {
      key: `m-${primary}`,
      index: primary,
      line: lines[primary],
      align: resolveAlign(primary, config.align),
    },
  ];

  const current = lines[primary];
  if (config.showTranslation && current.translatedLyric) {
    items.push({
      key: `t-${primary}`,
      index: primary,
      line: makePlaceholderLine(current.translatedLyric),
      align: resolveAlign(primary, config.align),
      isNext: true,
    });
    return items;
  }

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

/** 根节点颜色 CSS 变量 */
const rootStyle = computed(() => ({
  "--dl-played": config.playedColor,
  "--dl-unplayed": config.unplayedColor,
}));

/** 通知主进程把窗口高度锁定到当前字号对应值 */
const pushWindowHeight = (): void => {
  const target = computeWindowHeight(config.fontSize);
  window.api.desktopLyric.setHeight(target).catch((error) => {
    console.error("[desktop-lyric] setHeight failed", error);
  });
};

watch(() => config.fontSize, pushWindowHeight);

/** 顶栏按钮：聚焦主窗口 */
const focusMainWindow = (): void => {
  window.api.system.focusMainWindow().catch(() => {});
};
/** 顶栏按钮：广播播放控制事件 */
const dispatchPlayerEvent = (type: "prev" | "next" | "play" | "pause"): void => {
  window.api.player.dispatch(type);
};
/** 顶栏按钮：切换播放/暂停 */
const togglePlay = (): void => {
  dispatchPlayerEvent(playing.value ? "pause" : "play");
};
/** 顶栏按钮：打开设置（定位到桌面歌词分类） */
const openSettings = (): void => {
  window.api.system.openSettings("desktopLyric").catch(() => {});
};
/** 顶栏按钮：切换锁定状态 */
const toggleLocked = (): void => {
  window.api.config.set("desktopLyric.locked", !config.locked).catch(() => {});
};
/** 锁定时悬停解锁按钮：临时放开穿透以允许点击 */
const onLockBtnEnter = (): void => {
  if (config.locked) window.api.desktopLyric.setMouseIgnore(false);
};
const onLockBtnLeave = (): void => {
  if (config.locked) window.api.desktopLyric.setMouseIgnore(true);
};
/** 顶栏按钮：关闭桌面歌词窗口 */
const closeWindow = (): void => {
  window.api.window.closeDesktopLyric().catch(() => {});
};

/** hover 显示顶栏 / 背景；1s 无移动自动隐藏 */
const isHovered = ref(false);
let hoverTimer: number | null = null;
const HOVER_IDLE_MS = 1000;
const clearHoverTimer = (): void => {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
};
const startHoverIdle = (): void => {
  clearHoverTimer();
  hoverTimer = window.setTimeout(() => {
    isHovered.value = false;
    hoverTimer = null;
  }, HOVER_IDLE_MS);
};
const onDocMouseMove = (): void => {
  isHovered.value = true;
  startHoverIdle();
};
const onDocMouseLeave = (): void => {
  clearHoverTimer();
  isHovered.value = false;
};

/**
 * 自定义拖拽（对齐 SPlayer）：
 * - 挂载时预取一次 bounds 缓存到 cachedBounds
 * - pointerdown 同步从缓存拿起点，不等 IPC
 * - 拖拽前 freezeSize(true) 只钉 max，拖完 freezeSize(false) + 刷新缓存
 */
interface CachedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
const cachedBounds: CachedBounds = { x: 0, y: 0, width: 0, height: 0 };

const updateCachedBounds = async (): Promise<void> => {
  const bounds = await window.api.desktopLyric.getBounds();
  if (!bounds) return;
  cachedBounds.x = bounds.x;
  cachedBounds.y = bounds.y;
  cachedBounds.width = bounds.width;
  cachedBounds.height = bounds.height;
};

/** 监听渲染窗口尺寸变化，实时同步到缓存 */
const { width: winWidth, height: winHeight } = useWindowSize();
watch([winWidth, winHeight], ([w, h]) => {
  if (!dragState.dragging) {
    cachedBounds.width = w;
    cachedBounds.height = h;
  }
});

interface DragState {
  dragging: boolean;
  startScreenX: number;
  startScreenY: number;
  startWinX: number;
  startWinY: number;
  winWidth: number;
  winHeight: number;
}
const dragState: DragState = {
  dragging: false,
  startScreenX: 0,
  startScreenY: 0,
  startWinX: 0,
  startWinY: 0,
  winWidth: 0,
  winHeight: 0,
};
let moveRafPending = false;
let pendingX = 0;
let pendingY = 0;
const flushMove = (): void => {
  moveRafPending = false;
  window.api.desktopLyric.move(pendingX, pendingY, dragState.winWidth, dragState.winHeight);
};
const onPointerMove = (event: PointerEvent): void => {
  if (!dragState.dragging) return;
  const dx = event.screenX - dragState.startScreenX;
  const dy = event.screenY - dragState.startScreenY;
  pendingX = Math.round(dragState.startWinX + dx);
  pendingY = Math.round(dragState.startWinY + dy);
  if (!moveRafPending) {
    moveRafPending = true;
    requestAnimationFrame(flushMove);
  }
};
const onPointerUp = (): void => {
  if (!dragState.dragging) return;
  dragState.dragging = false;
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  window.api.desktopLyric.freezeSize(false);
  // 拖拽结束后刷新缓存供下一次拖拽使用
  updateCachedBounds();
};
const onRootPointerDown = (event: PointerEvent): void => {
  if (config.locked) return;
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".header-btn")) return;
  if (cachedBounds.width <= 0 || cachedBounds.height <= 0) return;
  dragState.dragging = true;
  dragState.startScreenX = event.screenX;
  dragState.startScreenY = event.screenY;
  dragState.startWinX = cachedBounds.x;
  dragState.startWinY = cachedBounds.y;
  dragState.winWidth = cachedBounds.width;
  dragState.winHeight = cachedBounds.height;
  window.api.desktopLyric.freezeSize(true);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  event.preventDefault();
};

const SYNC_DRIFT_THRESHOLD = 300;
let anchorInitialized = false;

const resetAnchor = (positionMs: number, sendTimestamp: number): void => {
  const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
  anchorPos = positionMs + (playing.value ? ipcDelay : 0);
  anchorPerf = performance.now();
  currentMs.value = anchorPos;
  anchorInitialized = true;
};

/** 仅当与 RAF 插值的偏差超过阈值时才重置锚点 */
const applyAnchor = (positionMs: number, sendTimestamp: number): void => {
  if (!anchorInitialized || !playing.value) {
    resetAnchor(positionMs, sendTimestamp);
    return;
  }
  const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
  const candidate = positionMs + ipcDelay;
  const projected = anchorPos + (performance.now() - anchorPerf);
  if (Math.abs(candidate - projected) > SYNC_DRIFT_THRESHOLD) {
    resetAnchor(positionMs, sendTimestamp);
  }
};

const applySnapshot = (snap: NowPlayingSnapshot): void => {
  track.value = snap.track;
  // 桌面歌词只展示主行
  const mainLines = snap.lyric.filter((line) => !line.isBG);
  lyric.value = clampLastLineEnd(mainLines, snap.track?.duration);
  playing.value = snap.playing;
  primaryIndex.value = -1;
  resetAnchor(snap.position, snap.sendTimestamp);
};

let rafId: number | null = null;
const syncOnce = (): void => {
  const next = playing.value ? anchorPos + (performance.now() - anchorPerf) : anchorPos;
  if (next !== currentMs.value) currentMs.value = next;
  const idx = pickPrimaryIndex(lyric.value, next);
  if (idx !== primaryIndex.value) primaryIndex.value = idx;
};

const tick = (): void => {
  syncOnce();
  rafId = playing.value ? requestAnimationFrame(tick) : null;
};

/** 触发一帧同步 */
const kickTick = (): void => {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
};

const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    const saved = await window.api.config.get("desktopLyric");
    Object.assign(config, saved as DesktopLyricSettings);
  } catch (error) {
    console.error("[desktop-lyric] load config failed", error);
  }

  pushWindowHeight();

  try {
    const snap = await window.api.nowPlaying.requestSnapshot();
    applySnapshot(snap);
  } catch (error) {
    console.error("[desktop-lyric] requestSnapshot failed", error);
  }

  unsubscribers.push(
    window.api.desktopLyric.onConfigChange((next) => Object.assign(config, next)),
    window.api.nowPlaying.onLyricChange((snap) => {
      applySnapshot(snap);
      kickTick();
    }),
    window.api.nowPlaying.onPositionSync((data: NowPlayingPositionSync) => {
      playing.value = data.playing;
      applyAnchor(data.position, data.sendTimestamp);
      kickTick();
    }),
  );

  kickTick();

  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseleave", onDocMouseLeave);

  // 预取窗口 bounds 缓存，供同步拖拽起点使用
  updateCachedBounds();
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearHoverTimer();
  document.removeEventListener("mousemove", onDocMouseMove);
  document.removeEventListener("mouseleave", onDocMouseLeave);
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div
    class="root"
    :class="{ hovered: isHovered, locked: config.locked }"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <div class="header">
      <div class="header-section header-left">
        <button class="header-btn" :title="track?.title ?? '回到主窗口'" @click="focusMainWindow">
          <IconLucideMusic />
        </button>
        <div class="song-info">
          <div class="song-title">{{ track?.title ?? "SPlayer Desktop Lyric" }}</div>
          <div v-if="track" class="song-artist">{{ artistsText || "未知艺术家" }}</div>
        </div>
      </div>
      <div class="header-section header-center">
        <button class="header-btn" title="上一曲" @click="dispatchPlayerEvent('prev')">
          <IconLucideSkipBack />
        </button>
        <button class="header-btn" :title="playing ? '暂停' : '播放'" @click="togglePlay">
          <IconLucidePause v-if="playing" />
          <IconLucidePlay v-else />
        </button>
        <button class="header-btn" title="下一曲" @click="dispatchPlayerEvent('next')">
          <IconLucideSkipForward />
        </button>
      </div>
      <div class="header-section header-right">
        <button class="header-btn" title="设置" @click="openSettings">
          <IconLucideSettings />
        </button>
        <button
          class="header-btn lock-btn"
          :title="config.locked ? '解锁窗口' : '锁定窗口'"
          @click="toggleLocked"
          @mouseenter="onLockBtnEnter"
          @mouseleave="onLockBtnLeave"
        >
          <IconLucideUnlock v-if="config.locked" />
          <IconLucideLock v-else />
        </button>
        <button class="header-btn" title="关闭桌面歌词" @click="closeWindow">
          <IconLucideX />
        </button>
      </div>
    </div>
    <TransitionGroup tag="div" name="dl-line" class="stage">
      <LyricLineView
        v-for="(item, index) in displayItems"
        :key="item.key"
        :line="item.line"
        :current-ms="currentMs"
        :font-size="item.isNext ? Math.round(config.fontSize * 0.8) : config.fontSize"
        :font-weight="config.fontWeight"
        :align="item.align"
        :word-by-word="resolveWordByWord(config, item)"
        :is-next="!!item.isNext"
        :style="{
          '--dl-y': getLineTop(index, config.fontSize),
        }"
      />
    </TransitionGroup>
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
  overflow: hidden;
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
