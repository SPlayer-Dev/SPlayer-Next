<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import CoverFlip from "./components/CoverFlip.vue";
import GlassBackground from "./components/GlassBackground.vue";
import ExpandedView from "./components/ExpandedView.vue";
import { pickAdvanceOnEndIndex } from "@shared/utils/lyricSync";
import { useNowPlayingSync, getNowPlayingCurrentMs } from "@windows/shared/composables/useNowPlayingSync";
import { isPureMusic } from "@windows/shared/utils/pureMusicDetect";
import { useExpandedView } from "./composables/useExpandedView";
import { useSpring } from "./composables/useSpring";
import { useDragWindow } from "./composables/useDragWindow";
import { isMac } from "@/utils/config";

const config = reactive<DynamicIslandSettings>({
  scale: 1,
  fontWeight: 500,
  fontFamily: "",
  wordByWord: true,
  playedColor: "rgba(255, 255, 255, 1)",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 1)",
  alwaysOnTop: true,
  snapCentered: true,
  horizontalOffset: 0,
  notchFusion: false,
  nonOcclusive: false,
  doubleLine: false,
  showTranslation: false,
  showSpectrum: true,
  spectrumStyle: "gradient",
  enableExpandedView: true,
  expandedTimeout: 8,
  backgroundStyle: "solid",
  enableCoverFlip: true,
});

const NOTCH_WIDTH = 181;
const NOTCH_HEIGHT = 29;
const NOTCH_TOP_FILL = 3;
const SHAPE_SIDE_OVERHANG = 5;
const MIN_SHAPE_WIDTH = NOTCH_WIDTH + SHAPE_SIDE_OVERHANG * 2;
const MAX_WINDOW_WIDTH = 480;
const MAX_WINDOW_WIDTH_RATIO = 0.35;
const MIN_LYRIC_SCALE = 0.78;

/* 悬停隐藏：非遮挡模式下仅在鼠标悬停时透明 */
const hovering = ref(false);

/* 窗口尺寸计算 */
const mainRowHeight = computed(() => Math.round(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale));

/* 主元素尺寸 */
const padX = computed(() => Math.round(mainRowHeight.value * 0.4));
const gap = computed(() => Math.round(mainRowHeight.value * 0.25));
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65));
const coverRadius = computed(() => Math.max(6, Math.round(coverSize.value * 0.35)));
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6));
const shapeBottomRadius = computed(() => Math.max(14, Math.round(coverRadius.value * 2)));

/* 副行尺寸 */
const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)));
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2));

/* 展开视图尺寸：固定 600×180，不随 mini 宽度或 scale 变化
 * 用户明确要求展开固定 600px，与 mini 模式解耦 */
const EXPANDED_WIDTH = 600;
const EXPANDED_HEIGHT = 180;

const { track, lyric, primaryIndex, playing } = useNowPlayingSync({
  pickIndex: pickAdvanceOnEndIndex,
  logTag: "dynamic-island",
  fftEnabled: true,
});

/* 展开/收起状态 */
const { currentView, expand, collapse, resetTimer } = useExpandedView(8);
const isExpanded = computed(() => currentView.value === "expanded");

/* Spring 驱动的展开进度 0~1，用于平滑动画（参数对齐 WinIsland：stiffness=0.12, damping=0.68） */
const expansionSpring = useSpring({ stiffness: 0.12, damping: 0.68, initial: 0 });
const expansionProgress = expansionSpring.value;

/* 展开/收起时缓存 mini 模式基准宽高，作为动画插值起点 */
let animBaseWidth = 0;
let animBaseHeight = 0;

/* 上次发送给主进程的窗口宽度，用于动画起点与实际窗口同步
 * 避免 rawLyricWidth 刚变化但 IPC 未完成时 animBaseWidth 与实际窗口宽度不一致导致首帧偏移 */
const lastSentWidth = ref(Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH));

watch(isExpanded, (expanded) => {
  /* 动画开始前用 lastSentWidth（实际窗口宽度）作为起点，避免与主进程不同步 */
  animBaseWidth = lastSentWidth.value;
  animBaseHeight = miniHeight.value;
  expansionSpring.setTarget(expanded ? 1 : 0);
});

/* mini 模式高度（非展开） */
const miniHeight = computed(
  () => contentHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0),
);

/* Spring 进度裁剪到 [0,1]
 * stiffness=0.12/damping=0.68 会有约 9% 过冲（峰值 1.089），导致 windowHeight/animatedWidth
 * 超过 EXPANDED 目标后回弹，主进程 clampWidth 还会裁剪到 640，视觉上窗口"弹"一下 */
const progress = computed(() => Math.max(0, Math.min(1, expansionProgress.value)));

/* 窗口高度：Spring 插值（裁剪后） */
const windowHeight = computed(() => {
  const p = progress.value;
  if (p <= 0.001) return miniHeight.value;
  if (p >= 0.999) return EXPANDED_HEIGHT;
  return Math.round(animBaseHeight + (EXPANDED_HEIGHT - animBaseHeight) * p);
});

/* 窗口宽度：Spring 插值（裁剪后）
 * progress=0 时返回 lastSentWidth（实际窗口宽度），避免与主进程不同步导致首帧偏移 */
const animatedWidth = computed(() => {
  const p = progress.value;
  if (p <= 0.001) return lastSentWidth.value;
  if (p >= 0.999) return EXPANDED_WIDTH;
  return Math.round(animBaseWidth + (EXPANDED_WIDTH - animBaseWidth) * p);
});

/* alpha 交叉：mini 可见到 p=0.7，expanded 从 p=0.2 开始到 p=0.7 完成
 * 重叠区 [0.2, 0.7] 内 mini 从 0.71→0、expanded 从 0→1，避免中间"空"的视觉 */
const miniAlpha = computed(() => Math.max(0, 1 - progress.value / 0.7));
const expandedAlpha = computed(() =>
  Math.max(0, Math.min(1, (progress.value - 0.2) / 0.5)),
);

/* 播放位置/时长（用于展开视图进度条） */
const position = ref(0);
const duration = computed(() => track.value?.duration ?? 0);

/* 播放控制 */
const handleSeek = (ms: number): void => {
  // 立即更新本地位置，避免等待 250ms 推送造成的视觉滞后
  position.value = ms;
  window.api.player.seek(ms);
  resetTimer();
};
const handlePrev = (): void => {
  window.api.player.dispatch("prev");
  resetTimer();
};
const handleNext = (): void => {
  window.api.player.dispatch("next");
  resetTimer();
};
const handleTogglePlay = (): void => {
  /* 直接调用 IPC，避免 dispatch 绕圈（渲染→主→渲染→主）增加延迟与竞态 */
  void window.api.player[playing.value ? "pause" : "play"]();
  resetTimer();
};

/* Mini 模式点击展开 */
const handleMiniClick = (): void => {
  if (config.enableExpandedView && !isExpanded.value) {
    // 立即同步播放位置，避免展开瞬间进度条停留在旧值
    position.value = getNowPlayingCurrentMs();
    expand(config.expandedTimeout);
  }
};

/* 窗口失焦时自动收起展开视图（点击非灵动岛位置触发） */
const handleWindowBlur = (): void => {
  if (isExpanded.value) collapse();
};

/* 窗口拖拽：非展开、非刘海融合、非穿透模式下允许 */
const { onContentPointerDown } = useDragWindow({
  enabled: () =>
    !isExpanded.value && !notchFusionEnabled.value && !config.nonOcclusive,
  onClick: handleMiniClick,
});

/* 窗口模式 */
const mode = ref<"snapped" | "floating">("snapped");
const viewportWidth = ref(Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH));
const viewportHeight = ref(Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT));
const animatedShapeWidth = ref(viewportWidth.value);
const notchFusionEnabled = computed(() => isMac && config.notchFusion && mode.value === "snapped");

/* 文本测量：优先使用 config.fontFamily，确保与渲染一致 */
const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string, sizePx: number = fontSize.value): number => {
  const family = config.fontFamily || getComputedStyle(document.documentElement).fontFamily;
  measureCtx.font = `${config.fontWeight} ${sizePx}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
};

/* 艺术家显示文本 */
const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

/* 当前行 */
const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

/* 纯音乐检测：
 * 1. 完全无歌词
 * 2. 所有行 words 为空
 * 3. 网易云返回"纯音乐，请欣赏"等标记（过滤信息行后只剩 1 行且含"纯音乐"）
 * mini 模式显示歌曲名（fallback），expanded 模式歌词区改为频谱 */
const isInstrumental = computed<boolean>(() => {
  if (!track.value) return false;
  const lines = lyric.value;
  if (!lines || lines.length === 0) return true;
  const allEmpty = lines.every(
    (line) => !line.words || line.words.every((w) => !w.word || w.word.trim() === ""),
  );
  if (allEmpty) return true;
  return isPureMusic(lines);
});

/* 备用文本：纯音乐或无当前行时显示歌曲名 */
const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "SPlayer";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

/* 实际显示的内容 */
const displayLine = shallowRef<LyricLine | null>(null);
/* 备用文本 */
const displayFallback = ref("SPlayer");
/* 当前行索引 */
const displayIndex = ref(-1);
/* 副行文本 */
const displaySubText = ref("");

/* 副行是否出现 */
const showSubLine = computed(() => config.doubleLine || displaySubText.value !== "");

const contentHeight = computed(
  () => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0),
);

// 回弹 easing cubic-bezier(0.34, 1.56, 0.64, 1) 峰值约 1.10
// 12% 留安全余量避免文本被裁
const BOUNCE_OVERSHOOT = 0.12;

/* 歌词宽度 */
const rawLyricWidth = ref(measureTextWidth(displayFallback.value));
const lyricWidth = ref(rawLyricWidth.value);
const lyricOpacity = ref(1);

/* 是否正在收缩 */
const shrinking = ref(false);
/* 是否正在展开（淡入阶段，用于 Y 位移） */
const expanding = ref(false);
/* 窗口阶段 */
let phase: "idle" | "shrinking" | "expanding" = "idle";

/* 是否已经渲染过 */
let hasPainted = false;

/* 行文本 */
const lineText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

/* 计算副行文本 */
const computeSubText = (idx: number, line: LyricLine | null): string => {
  if (config.showTranslation && line?.translatedLyric) return line.translatedLyric;
  if (!config.doubleLine || idx < 0) return "";
  const next = lyric.value[idx + 1];
  return next ? lineText(next) : "";
};

/* 计算目标宽度：纯音乐时用歌曲名宽度，非纯音乐用歌词宽度 */
const measureTarget = (): number => {
  /* 纯音乐时测量 fallback 文本宽度，不测歌词行 */
  const line = currentLine.value;
  const mainText = line && !isInstrumental.value ? lineText(line) : fallbackText.value;
  const mainPx = Math.max(1, measureTextWidth(mainText));
  const subText = computeSubText(primaryIndex.value, line);
  const subPx = subText ? measureTextWidth(subText, subFontSize.value) : 0;
  return Math.max(mainPx, subPx);
};

const getRendererWindowLimit = (): number =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.min(MAX_WINDOW_WIDTH, Math.floor(window.screen.width * MAX_WINDOW_WIDTH_RATIO)),
  );

const fixedContentWidth = computed(() => padX.value * 2 + coverSize.value + gap.value);
const shapeExtraWidth = computed(() => (notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG * 2 : 0));

const maxLyricSlotWidth = computed(() => {
  const windowLimit = getRendererWindowLimit();
  if (notchFusionEnabled.value) {
    // 刘海融合：窗口宽度固定为刘海宽，slot 受当前窗口宽约束
    const currentWindowWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
    return Math.max(
      1,
      Math.min(windowLimit, currentWindowWidth) - fixedContentWidth.value - shapeExtraWidth.value,
    );
  }
  // 浮动/普通模式：窗口可grow到 windowLimit，slot 按 max 计算，超出则截断显示省略号
  return Math.max(1, windowLimit - fixedContentWidth.value - shapeExtraWidth.value);
});

const getLyricSlotWidth = (lyricPx: number): number =>
  Math.min(Math.max(1, Math.round(lyricPx)), maxLyricSlotWidth.value);

/* 计算窗口宽度 */
const computeWindowWidth = (lyricPx: number): number => {
  const bounceExtra = Math.ceil(lyricPx * BOUNCE_OVERSHOOT);
  return Math.max(
    notchFusionEnabled.value ? MIN_SHAPE_WIDTH : 1,
    fixedContentWidth.value + lyricPx + bounceExtra + shapeExtraWidth.value,
  );
};

/* 调整窗口宽度 */
const resizeWindow = (lyricPx: number): void => {
  /* 展开动画期间不调整宽度，由 animatedWidth watcher 统一管理 */
  if (progress.value > 0.001) return;
  const targetWidth = computeWindowWidth(lyricPx);
  /* 记录上次发送给主进程的宽度，作为动画起点 */
  lastSentWidth.value = targetWidth;
  if (!notchFusionEnabled.value) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    return;
  }

  const currentWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
  if (targetWidth >= currentWidth) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    requestAnimationFrame(() => {
      animatedShapeWidth.value = targetWidth;
    });
    return;
  }

  animatedShapeWidth.value = targetWidth;
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
  }
  pendingWindowShrinkTimer = window.setTimeout(() => {
    pendingWindowShrinkTimer = null;
    if (notchFusionEnabled.value) {
      window.api.dynamicIsland.resize(targetWidth);
    }
  }, 520);
};

const applyMeasuredWidth = (targetPx: number): void => {
  rawLyricWidth.value = targetPx;
  lyricWidth.value = getLyricSlotWidth(targetPx);
  resizeWindow(targetPx);
};

const truncateTextToWidth = (text: string, maxWidth: number, sizePx: number): string => {
  if (!text || measureTextWidth(text, sizePx) <= maxWidth) return text;
  const ellipsis = "...";
  const ellipsisWidth = measureTextWidth(ellipsis, sizePx);
  if (maxWidth <= ellipsisWidth) return ellipsis;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureTextWidth(`${text.slice(0, mid)}${ellipsis}`, sizePx) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

/* 立即应用 */
const applyImmediate = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
  const targetPx = measureTarget();
  shrinking.value = false;
  expanding.value = false;
  lyricOpacity.value = 1;
  applyMeasuredWidth(targetPx);
  /* 无渐变动画，直接回到 idle，避免阻塞后续 config/dimension watch */
  phase = "idle";
};

/* 开始交换动画：opacity 淡出 + Y 上移 → 更新内容 → opacity 淡入 + Y 从下方回中 */
let swapTimer: number | null = null;
const SWAP_FADE_MS = 200;

const startSwapAnimation = (): void => {
  phase = "shrinking";
  shrinking.value = true;
  expanding.value = false;
  lyricOpacity.value = 0;
  if (swapTimer !== null) window.clearTimeout(swapTimer);
  swapTimer = window.setTimeout(() => {
    if (phase !== "shrinking") return;
    /* 更新内容 */
    displayLine.value = currentLine.value;
    displayFallback.value = fallbackText.value;
    displayIndex.value = primaryIndex.value;
    displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
    const targetPx = measureTarget();
    rawLyricWidth.value = targetPx;
    /* shrinking 期间无 width transition，先瞬间更新宽度和窗口 */
    lyricWidth.value = getLyricSlotWidth(targetPx);
    resizeWindow(targetPx);
    /* 切换到 expanding：加 is-expanding 让 translateY 瞬间跳到下方（无 transition） */
    shrinking.value = false;
    expanding.value = true;
    /* 双 rAF：确保 is-expanding（translateY(3px)）已 paint，再移除触发 transition 回 0 */
    requestAnimationFrame(() => {
      if (phase !== "shrinking") return;
      requestAnimationFrame(() => {
        if (phase !== "shrinking") return;
        phase = "expanding";
        expanding.value = false;
        lyricOpacity.value = 1;
        /* 淡入完成后回到 idle */
        if (swapTimer !== null) window.clearTimeout(swapTimer);
        swapTimer = window.setTimeout(() => {
          if (phase === "expanding") phase = "idle";
        }, SWAP_FADE_MS);
      });
    });
  }, SWAP_FADE_MS);
};

/* 开关切换后立即重算副行 + 同步窗口宽度，不走 swap 动画 */
watch([() => config.doubleLine, () => config.showTranslation], () => {
  displaySubText.value = computeSubText(displayIndex.value, displayLine.value);
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

/* 尺寸/字重变化：重测宽度，不走 swap 动画 */
watch([() => config.scale, () => config.fontWeight, () => config.fontFamily], () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch(notchFusionEnabled, () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

/* 纯音乐状态变化：从歌词切换到频谱或反之，重新测量宽度 */
watch(isInstrumental, () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

/* 歌词变化 */
watch([currentLine, fallbackText], () => {
  const newLine = currentLine.value;
  const changed = newLine
    ? displayIndex.value !== primaryIndex.value
    : displayFallback.value !== fallbackText.value;
  if (!changed) return;
  // 正在缩，等 transitionend 时自然会用最新数据
  if (phase === "shrinking") return;
  // 首次 paint 尚未完成或 lyricWidth 已经为 0 → 跳过 shrink 直接展开
  if (!hasPainted || lyricWidth.value === 0) {
    applyImmediate();
    return;
  }
  // 展开/收起动画进行中：mini 歌词不可见，swap 动画无意义且会叠加导致视觉混乱
  if (progress.value > 0.001 && progress.value < 0.999) {
    applyImmediate();
    return;
  }
  startSwapAnimation();
});

const lyricScale = computed(() => {
  if (!notchFusionEnabled.value) return 1;
  const rawWidth = Math.max(1, rawLyricWidth.value);
  const slotWidth = Math.max(1, lyricWidth.value);
  return Math.max(MIN_LYRIC_SCALE, Math.min(1, slotWidth / rawWidth));
});

const lyricLayoutWidth = computed(() =>
  Math.max(1, Math.floor(Math.max(1, lyricWidth.value) / lyricScale.value)),
);

const displayMainText = computed(() =>
  displayLine.value && !isInstrumental.value
    ? lineText(displayLine.value)
    : displayFallback.value,
);

const fittedMainText = computed(() =>
  truncateTextToWidth(displayMainText.value, lyricLayoutWidth.value, fontSize.value),
);

const mainTextTruncated = computed(() => fittedMainText.value !== displayMainText.value);

const fittedDisplayLine = computed<LyricLine | null>(() => {
  /* 纯音乐时不显示歌词行，强制走 fallback（歌曲名） */
  if (isInstrumental.value) return null;
  const line = displayLine.value;
  if (!line || !mainTextTruncated.value) return line;
  return {
    ...line,
    words: [
      {
        startTime: line.startTime,
        endTime: line.endTime,
        word: fittedMainText.value,
      },
    ],
  };
});

const fittedSubText = computed(() =>
  truncateTextToWidth(displaySubText.value, lyricLayoutWidth.value, subFontSize.value),
);

const shapeWidth = computed(() => {
  /* 展开动画期间跟随 animatedWidth，保证 SVG 形状与窗口同步 */
  if (progress.value > 0.001) {
    return Math.max(MIN_SHAPE_WIDTH, Math.round(animatedWidth.value));
  }
  return Math.max(
    MIN_SHAPE_WIDTH,
    Math.round(notchFusionEnabled.value ? animatedShapeWidth.value : viewportWidth.value),
  );
});
const shapeHeight = computed(() => Math.max(windowHeight.value, Math.round(viewportHeight.value)));

const notchPath = computed(() => {
  const width = shapeWidth.value;
  const height = shapeHeight.value;
  const overhang = Math.min(SHAPE_SIDE_OVERHANG, width / 4);
  const bodyLeft = overhang;
  const bodyRight = width - overhang;
  const topArc = Math.min(overhang, height / 4);
  const bottomRadius = Math.min(shapeBottomRadius.value, width / 2, height / 2);

  return [
    "M 0 0",
    `L ${width} 0`,
    `Q ${bodyRight} 0 ${bodyRight} ${topArc}`,
    `L ${bodyRight} ${height - bottomRadius}`,
    `Q ${bodyRight} ${height} ${bodyRight - bottomRadius} ${height}`,
    `L ${bodyLeft + bottomRadius} ${height}`,
    `Q ${bodyLeft} ${height} ${bodyLeft} ${height - bottomRadius}`,
    `L ${bodyLeft} ${topArc}`,
    `Q ${bodyLeft} 0 0 0`,
    "Z",
  ].join(" ");
});

/* 根节点样式 */
const rootStyle = computed(() => ({
  "--di-played": config.playedColor,
  "--di-unplayed": config.unplayedColor,
  "--di-bg": config.backgroundColor,
  "--di-padx": `${padX.value}px`,
  "--di-gap": `${gap.value}px`,
  "--di-cover": `${coverSize.value}px`,
  "--di-cover-radius": `${coverRadius.value}px`,
  "--di-side-overhang": `${notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG : 0}px`,
  "--di-row": `${mainRowHeight.value}px`,
  "--di-content-height": `${contentHeight.value}px`,
  "--di-notch": `${NOTCH_HEIGHT}px`,
  "--di-shape-width": `${shapeWidth.value}px`,
  "--di-fusion-content-width": `${Math.max(1, shapeWidth.value - SHAPE_SIDE_OVERHANG * 2)}px`,
  "--di-snap-radius": `${snapRadius.value}px`,
  "--di-lyric-scale": lyricScale.value,
  fontFamily: config.fontFamily || undefined,
}));

const syncViewportSize = (): void => {
  viewportWidth.value = Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH);
  viewportHeight.value = Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT);
  if (!notchFusionEnabled.value) {
    animatedShapeWidth.value = viewportWidth.value;
  }
};

watch(
  maxLyricSlotWidth,
  () => {
    if (phase === "shrinking") return;
    lyricWidth.value = getLyricSlotWidth(rawLyricWidth.value);
  },
  { flush: "post" },
);

/* 取消订阅 */
let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;
let unsubCursor: (() => void) | null = null;
let pendingWindowShrinkTimer: number | null = null;
let positionIntervalId: number | null = null;

/* 窗口目标尺寸：合并宽高，单个 watcher 单次 IPC
 * 展开动画期间（progress > 0.001）由 Spring 驱动宽高，用 setBounds 一次上报
 * mini 模式下 width 由 resizeWindow 处理，height 仍需单独上报（contentHeight 变化时） */
const windowBounds = computed(() => ({
  width: animatedWidth.value,
  height: windowHeight.value,
  expanded: progress.value > 0.001,
}));

watch(
  windowBounds,
  ({ width, height, expanded }) => {
    if (expanded) {
      window.api.dynamicIsland.setBounds(width, height);
    } else {
      window.api.dynamicIsland.setHeight(height);
    }
  },
  /* flush: "sync" 让 IPC 在 progress 变化的同一帧立即发出，
   * 避免 flush: "post" 等待 DOM 更新造成的末帧延迟（动画收尾卡顿） */
  { flush: "sync" },
);

onMounted(async () => {
  syncViewportSize();
  window.addEventListener("resize", syncViewportSize);
  // 窗口失焦时自动收起（点击非灵动岛位置触发）
  window.addEventListener("blur", handleWindowBlur);
  // 初始窗口宽度匹配 fallback 文本宽度，避免启动时窗口偏心
  resizeWindow(rawLyricWidth.value);
  // 确保初始 width 被浏览器 paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hasPainted = true;
    });
  });
  try {
    /* 获取保存的配置和模式 */
    const [saved, currentMode] = await Promise.all([
      window.api.config.get("dynamicIsland") as Promise<DynamicIslandSettings>,
      window.api.dynamicIsland.getMode(),
    ]);
    Object.assign(config, saved);
    mode.value = currentMode;
  } catch (error) {
    console.error("[dynamic-island] load state failed", error);
  }
  // 订阅 FFT 推送：主进程维护引用计数，任一窗口订阅即保持推送
  // 与 taskbar-lyric 共享同一计数器，互不影响
  if (config.showSpectrum) {
    window.api.player.setFftEnabled(true).catch(() => {});
  }
  unsubConfig = window.api.dynamicIsland.onConfigChange((next) => {
    const prevShowSpectrum = config.showSpectrum;
    Object.assign(config, next as DynamicIslandSettings);
    // 频谱开关变化时同步 FFT 订阅
    if (config.showSpectrum !== prevShowSpectrum) {
      window.api.player.setFftEnabled(config.showSpectrum).catch(() => {});
    }
  });
  unsubMode = window.api.dynamicIsland.onModeChange((next) => {
    mode.value = next;
  });
  // 悬停判定
  unsubCursor = window.api.dynamicIsland.onCursorInside((inside) => {
    hovering.value = inside;
  });
  // 展开视图进度条更新
  positionIntervalId = window.setInterval(() => {
    if (isExpanded.value) {
      position.value = getNowPlayingCurrentMs();
    }
  }, 250);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncViewportSize);
  window.removeEventListener("blur", handleWindowBlur);
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
    pendingWindowShrinkTimer = null;
  }
  if (swapTimer !== null) {
    window.clearTimeout(swapTimer);
    swapTimer = null;
  }
  if (positionIntervalId !== null) {
    window.clearInterval(positionIntervalId);
    positionIntervalId = null;
  }
  // 取消 FFT 订阅（引用计数 -1）
  if (config.showSpectrum) {
    window.api.player.setFftEnabled(false).catch(() => {});
  }
  unsubConfig?.();
  unsubConfig = null;
  unsubMode?.();
  unsubMode = null;
  unsubCursor?.();
  unsubCursor = null;
});
</script>

<template>
  <div
    class="root"
    :class="[
      mode === 'snapped' ? 'is-snapped' : 'is-floating',
      {
        'is-hidden': config.nonOcclusive && hovering,
        'is-notch-fusion': notchFusionEnabled,
        'is-expanded': isExpanded,
        'has-custom-bg': config.backgroundStyle !== 'solid',
      },
    ]"
    :style="rootStyle"
  >
    <svg
      v-if="notchFusionEnabled"
      class="notch-shape"
      :viewBox="`0 0 ${shapeWidth} ${shapeHeight}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="notchPath" fill="var(--di-bg)" />
    </svg>
    <!-- 毛玻璃背景 -->
    <GlassBackground
      v-if="config.backgroundStyle !== 'solid'"
      :background-style="config.backgroundStyle"
      :cover-src="track?.cover || ''"
    />
    <!-- Mini 模式内容 -->
    <div
      class="content"
      :style="{ opacity: Math.max(0, miniAlpha) }"
      @pointerdown="onContentPointerDown"
    >
      <div class="cover">
        <CoverFlip
          v-if="config.enableCoverFlip"
          :src="track?.cover || DEFAULT_COVER"
          :size="coverSize"
          :radius="coverRadius"
          :default-src="DEFAULT_COVER"
        />
        <img
          v-else
          :src="track?.cover || DEFAULT_COVER"
          alt="cover"
          draggable="false"
          decoding="async"
          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
        />
      </div>
      <div
        class="lyric"
        :class="{ 'is-shrinking': shrinking, 'is-expanding': expanding }"
        :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }"
      >
        <div
          class="lyric-scale"
          :style="
            notchFusionEnabled
              ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` }
              : {}
          "
        >
          <div class="main-line">
            <IslandLyricLine
              v-if="fittedDisplayLine"
              :line="fittedDisplayLine"
              :font-size="fontSize"
              :font-weight="config.fontWeight"
              :word-by-word="config.wordByWord && !mainTextTruncated"
            />
            <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
              {{ fittedMainText }}
            </div>
          </div>
          <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">
            {{ fittedSubText }}
          </div>
        </div>
      </div>
    </div>
    <!-- 展开视图：动画期间保持挂载，由 expandedAlpha 控制透明度 -->
    <ExpandedView
      v-if="config.enableExpandedView && (isExpanded || progress > 0.001)"
      :track="track"
      :playing="playing"
      :position="position"
      :duration="duration"
      :config="config"
      :current-line="currentLine"
      :is-instrumental="isInstrumental"
      :style="{ opacity: expandedAlpha }"
      @seek="handleSeek"
      @prev="handlePrev"
      @next="handleNext"
      @toggle-play="handleTogglePlay"
      @interact="resetTimer"
    />
    <!-- 点击空白区域收起：动画期间保持挂载 -->
    <div
      v-if="isExpanded || progress > 0.001"
      class="collapse-overlay"
      @click.stop="collapse"
    />
  </div>
</template>

<style scoped>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--di-played);
  transition:
    border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.2s ease-out;
}
/* opacity 不影响穿透判定，鼠标离开物理区域后自然恢复 */
.root.is-hidden {
  opacity: 0;
}
.root.is-expanded:not(.is-notch-fusion) {
  width: 100%;
  background: var(--di-bg);
}
.root.is-expanded:not(.is-notch-fusion).has-custom-bg {
  background: transparent;
}
.root.is-notch-fusion {
  width: 100%;
}
.root:not(.is-notch-fusion) {
  width: fit-content;
  background: var(--di-bg);
}
.root:not(.is-notch-fusion).has-custom-bg {
  background: transparent;
}
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
.root.is-snapped.is-notch-fusion {
  background: transparent;
  border-radius: 0;
}
.root.is-floating {
  background: var(--di-bg);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.root.is-floating.has-custom-bg {
  background: transparent;
}
.notch-shape {
  position: absolute;
  top: 0;
  left: 50%;
  width: var(--di-shape-width);
  height: 100%;
  transform: translateX(-50%);
  pointer-events: none;
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  min-width: 0;
  height: 100%;
  padding: 0 var(--di-padx);
  box-sizing: border-box;
}
.root:not(.is-notch-fusion) .content {
  width: fit-content;
}
.root.is-notch-fusion .content {
  width: 100%;
}
.root.is-snapped.is-notch-fusion .content {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--di-fusion-content-width);
  height: var(--di-content-height);
  transform: translateX(-50%);
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.cover {
  flex: 0 0 auto;
  width: var(--di-cover);
  height: var(--di-cover);
  border-radius: var(--di-cover-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}
.lyric {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
  transform: translateY(0);
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
}
/* 淡出阶段：向上滑出 + opacity 0 */
.lyric.is-shrinking {
  transform: translateY(-3px);
  transition:
    opacity 0.2s ease-in,
    transform 0.2s ease-in;
}
/* 淡入起点：瞬间跳到下方（无 transition），随后移除 class 触发 transition 回 0 */
.lyric.is-expanding {
  transform: translateY(3px);
  transition: none;
}
.lyric-scale {
  flex: 0 0 auto;
  min-width: 0;
  transform-origin: center center;
}
.main-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.fallback {
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  /* 副行是辅助信息，独立于"未播放色"配置，用透明度做暗化 */
  opacity: 0.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root.is-expanded {
  cursor: default;
}
.root.is-expanded.is-snapped {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.root.is-expanded.is-floating {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.collapse-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: default;
}
.root.is-expanded .content {
  pointer-events: none;
}
</style>
