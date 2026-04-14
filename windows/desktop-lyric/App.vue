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
  computeLinesHeight,
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
  translationColor: "#b3b3b3",
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
      isTranslation: true,
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
  "--dl-trans": config.translationColor,
}));

/** 两行容器需要的高度 */
const linesHeight = computed(() => computeLinesHeight(config.fontSize));

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
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div class="root" :style="rootStyle">
    <div class="title" :style="{ textAlign: config.align === 'justify' ? 'center' : config.align }">
      <div class="title-name">{{ track?.title ?? "暂无播放" }}</div>
      <div v-if="track" class="title-artist">{{ artistsText || "未知艺术家" }}</div>
    </div>
    <div class="stage">
      <TransitionGroup
        tag="div"
        name="dl-line"
        class="lines"
        :style="{ height: `${linesHeight}px` }"
      >
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
            ...(item.isTranslation ? { '--dl-line-color': 'var(--dl-trans)' } : {}),
          }"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.root {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 24px;
  color: var(--dl-played);
  box-sizing: border-box;
}
.title {
  flex: 0 0 auto;
  width: 100%;
  padding-top: 4px;
  color: var(--dl-played);
}
.title-name {
  font-size: 13px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title-artist {
  font-size: 11px;
  line-height: 1.3;
  color: var(--dl-unplayed);
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
.lines {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
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
