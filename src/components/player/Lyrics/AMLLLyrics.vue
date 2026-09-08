<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { LyricPlayer as CoreLyricPlayer } from "@applemusic-like-lyrics/core";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime } from "@/services/playback";
import { observeAmllRubyLayout } from "./utils/amll-ruby-layout";
import "@applemusic-like-lyrics/core/style.css";
import "./renderer.css";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 是否正在播放（默认 true） */
    playing?: boolean;
    /** 激活行在容器中的对齐位置 [0 ~ 1] */
    alignPosition?: number;
    /** 逐字掩码渐变宽度比例 */
    wordFadeWidth?: number;
    /** 是否隐藏已播放行 */
    hidePassedLines?: boolean;
    /** 是否启用逐行模糊效果 */
    enableBlur?: boolean;
    /** 是否显示翻译歌词 */
    showTranslation?: boolean;
    /** 是否显示逐行音译 */
    showLineRomanization?: boolean;
    /** 是否显示逐词音译 */
    showWordRomanization?: boolean;
    /** 挂载时的初始播放时间（毫秒） */
    initialTime?: number;
  }>(),
  {
    playing: false,
    alignPosition: 0.35,
    wordFadeWidth: 0.5,
    hidePassedLines: false,
    enableBlur: false,
    showTranslation: true,
    showLineRomanization: true,
    showWordRomanization: true,
    initialTime: 0,
  },
);

interface Emits {
  /** 点击歌词行进行播放进度跳转 */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const settings = useSettingsStore();
const status = useStatusStore();

const wrapperRef = ref<HTMLDivElement | null>(null);
const playerRef = ref<CoreLyricPlayer>();
let stopRubyLayout: (() => void) | undefined;
const bottomLineEl = ref<HTMLElement>();
const clockInitialized = ref(false);
// 播放器是否已初始化完成
const initialized = ref(false);
const contentVisible = ref(false);
// 父组件的冻结标志
const isFrozen = ref(false);
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;
// 页面隐藏状态的响应式跟踪
const isPageHidden = ref(false);
// 之前隐藏的标记，用于检测从隐藏恢复的时刻
const isPreviousHidden = ref(false);

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

// 处理多语言显隐及音译偏好的本地高效清洗
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  return props.lyricLines.map((line) => {
    const newLine = {
      ...line,
      translatedLyric: props.showTranslation ? line.translatedLyric : "",
      romanLyric: props.showLineRomanization ? line.romanLyric : "",
    };
    if (line.words) {
      newLine.words = line.words.map((word) => {
        const newWord = { ...word };
        if (!props.showWordRomanization) {
          delete newWord.romanWord;
        }
        return newWord;
      });
    }
    return newLine;
  });
});

// 行点击事件回调
const handleLineClick = (e: Event) => {
  const amllEvent = e as Event & { line?: { getLine: () => { startTime?: number } } };
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
    playerRef.value?.setCurrentTime(lineData.startTime, true);
  }
};

// 为所有主歌词行设置 html lang 属性
const processLyricLanguage = (player = playerRef.value) => {
  const lyricGroups = player?.currentLyricGroups;
  if (!Array.isArray(lyricGroups) || lyricGroups.length === 0) return;

  for (const group of lyricGroups) {
    for (const line of [group.mainLine, group.bgLine]) {
      const lyricLine = line?.getLine();
      const lyricLineElement = line?.getElement();
      if (!lyricLine || !lyricLineElement) continue;

      const lyricMainLineElement = lyricLineElement.firstChild;
      if (lyricMainLineElement instanceof HTMLElement) {
        const language = (lyricLine as LyricLine).language;
        if (language) lyricMainLineElement.lang = language;
        else lyricMainLineElement.removeAttribute("lang");
      }
    }
  }
};

/** 同步播放器配置 */
const syncPlayerOptions = (player = playerRef.value): void => {
  if (!player) return;
  player.setAlignPosition(props.alignPosition);
  player.setAlignAnchor(props.alignPosition > 0.4 ? "center" : "top");
  player.setWordFadeWidth(props.wordFadeWidth);
  player.setHidePassedLines(props.hidePassedLines);
  player.setEnableBlur(props.enableBlur);

  const useSpring = settings.lyric.useAMSpring;
  player.setEnableSpring(useSpring);
  player.setEnableScale(useSpring);
  player.setLinePosYSpringParams({
    mass: settings.lyric.amllVerticalSpringMass,
    damping: settings.lyric.amllVerticalSpringDamping,
    stiffness: settings.lyric.amllVerticalSpringStiffness,
    soft: settings.lyric.amllVerticalSpringSoft,
  });
  player.setLineScaleSpringParams({
    mass: settings.lyric.amllScaleSpringMass,
    damping: settings.lyric.amllScaleSpringDamping,
    stiffness: settings.lyric.amllScaleSpringStiffness,
    soft: settings.lyric.amllScaleSpringSoft,
  });
};

const { resume: resumeRaf, pause: pauseRaf } = useRafFn(
  ({ delta }) => {
    playerRef.value?.update(delta);
  },
  { immediate: false },
);

// 页面隐藏时停止渲染循环，恢复时校准时间线
const handleVisibility = () => {
  const hidden = document.hidden;
  isPageHidden.value = hidden; // 更新响应式隐藏状态
  if (hidden) {
    pauseRaf();
    playerRef.value?.pause();
    isPreviousHidden.value = true;
  } else if (isPreviousHidden.value && !isFrozen.value && playerRef.value) {
    // 从隐藏恢复：校准 Core 内部时钟到当前播放位置，避免逐词效果从头开始
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value.setCurrentTime(currentTime, true);
    isPreviousHidden.value = false;
    // 恢复后根据当前状态决定 resume/pause（由 watchEffect 处理，这里只需确保 state sync）
  }
};

onMounted(async () => {
  if (!wrapperRef.value) return;
  const player = new CoreLyricPlayer();
  playerRef.value = player;

  const el = player.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  wrapperRef.value.appendChild(el);
  stopRubyLayout = observeAmllRubyLayout(player);

  const bottomEl = player.getBottomLineElement();
  if (bottomEl) {
    bottomEl.classList.add("lp-line", "lp-credit");
    bottomLineEl.value = bottomEl;
  }

  player.addEventListener("line-click", handleLineClick);

  player.setOptimizeOptions({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  });
  syncPlayerOptions(player);
  document.addEventListener("visibilitychange", handleVisibility);

  await nextTick();
  await nextFrame();
  if (playerRef.value !== player) return;

  if (processedLyrics.value.length > 0) {
    player.setLyricLines(processedLyrics.value, props.initialTime);
    processLyricLanguage(player);
  } else if (Number.isFinite(props.initialTime) && props.initialTime >= 0) {
    player.setCurrentTime(props.initialTime, true);
  }

  await nextFrame();
  if (playerRef.value !== player) return;
  if (pendingLyrics) {
    player.setLyricLines(pendingLyrics, getCurrentTime() + status.lyricOffsetMs);
    pendingLyrics = null;
    processLyricLanguage(player);
    await nextFrame();
    if (playerRef.value !== player) return;
  }
  player.setCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
  player.update(0);
  initialized.value = true;
  contentVisible.value = true;
});

onUnmounted(() => {
  stopRubyLayout?.();
  stopRubyLayout = undefined;
  document.removeEventListener("visibilitychange", handleVisibility);
  pauseRaf();
  initialized.value = false;
  contentVisible.value = false;
  if (playerRef.value) {
    playerRef.value.removeEventListener("line-click", handleLineClick);
    playerRef.value.dispose();
    playerRef.value = undefined;
    bottomLineEl.value = undefined;
  }
});

// 同步播放/冻结状态到 Core 及渲染循环
watchEffect(() => {
  const player = playerRef.value;
  if (!player || !initialized.value) return;

  // 首次运行时校准一次（避免重复）
  if (!clockInitialized.value) {
    player.update(0);
    clockInitialized.value = true;
  }

  const playing = props.playing;
  const frozen = isFrozen.value;
  const hidden = isPageHidden.value; // 使用响应式隐藏状态

  if (!frozen && !hidden) {
    // 只要未冻结且可见，就持续运行 RAF 维持渲染（即使暂停也要保持画面）
    resumeRaf();
    if (playing) {
      player.resume();
    } else {
      player.pause();
    }
  } else {
    pauseRaf();
    player.pause();
  }
});

watch(
  () => [
    props.alignPosition,
    props.wordFadeWidth,
    props.hidePassedLines,
    props.enableBlur,
    settings.lyric.useAMSpring,
    settings.lyric.amllVerticalSpringMass,
    settings.lyric.amllVerticalSpringDamping,
    settings.lyric.amllVerticalSpringStiffness,
    settings.lyric.amllVerticalSpringSoft,
    settings.lyric.amllScaleSpringMass,
    settings.lyric.amllScaleSpringDamping,
    settings.lyric.amllScaleSpringStiffness,
    settings.lyric.amllScaleSpringSoft,
  ],
  () => syncPlayerOptions(),
);

// 监听处理完的歌词数据变动
watch(processedLyrics, (newLyrics) => {
  if (!playerRef.value) return;
  if (!initialized.value || isFrozen.value) {
    pendingLyrics = newLyrics;
  } else {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value.setLyricLines(newLyrics, currentTime);
    processLyricLanguage();
  }
});

// 监听歌词优化配置变动并更新 Core
watch(
  () => ({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  }),
  (options) => {
    if (!playerRef.value) return;
    playerRef.value.setOptimizeOptions(options);
    if (processedLyrics.value.length > 0 && !isFrozen.value) {
      const currentTime = getCurrentTime() + status.lyricOffsetMs;
      playerRef.value.setLyricLines(processedLyrics.value, currentTime);
      processLyricLanguage();
    }
  },
  { deep: true },
);

// 主播放器事件驱动的时间同步接口
const setCurrentTime = (time: number, isSeek?: boolean) => {
  playerRef.value?.setCurrentTime(time, isSeek);
};

// 隐藏界面或休眠时调用
const freeze = () => {
  isFrozen.value = true;
};

// 恢复播放和滚动测量
const resume = () => {
  if (!initialized.value) {
    isFrozen.value = false;
    return;
  }
  if (pendingLyrics) {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value?.setLyricLines(pendingLyrics, currentTime);
    processLyricLanguage();
    pendingLyrics = null;
  }
  isFrozen.value = false;
};

defineExpose({
  setCurrentTime,
  freeze,
  resume,
  lyricPlayer: playerRef,
});
</script>

<template>
  <div ref="wrapperRef" class="amll-lyrics-container" :class="contentVisible ? 'is-visible' : ''" />
  <Teleport v-if="bottomLineEl" :to="bottomLineEl">
    <slot name="bottom" />
  </Teleport>
</template>

<style scoped>
.amll-lyrics-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.amll-lyrics-container.is-visible {
  opacity: 1;
}

:deep(.amll-lyric-player) {
  --amll-lp-font-size: 1em;
  --amll-lp-color: var(--lp-color, #fff);
  width: 100%;
  height: 100%;
}

:deep(:lang(zh)) {
  font-family: var(--lyric-font-zh, inherit);
}

:deep(:lang(ja)) {
  font-family: var(--lyric-font-ja, inherit);
}

:deep(:lang(ko)) {
  font-family: var(--lyric-font-ko, inherit);
}

:deep(:lang(und-Latn)) {
  font-family: var(--lyric-font-latin, inherit);
}

/* AMLL 将含 ruby 行的词正文设为纵向 flex；强调词拆成字符后需恢复横排 */
:deep(.FmKaba_wordWithRuby.FmKaba_emphasize .FmKaba_wordBody) {
  flex-direction: row;
}

:deep(.FmKaba_lyricMainLine .FmKaba_rubyWord) {
  width: 0;
  overflow: visible;
  translate: var(--amll-ruby-offset, 0px) 0;
}

:deep(.FmKaba_rubyWord > span) {
  flex-shrink: 0;
  white-space: pre;
}

:deep(.FmKaba_lyricMainLine .FmKaba_wordWithRuby) {
  padding: var(--amll-ruby-padding, 1em);
  margin: calc(-1 * var(--amll-ruby-padding, 1em));
}

:deep(.FmKaba_lyricLine:has(.FmKaba_rubyWord > span)) {
  contain: layout style;
  content-visibility: visible;
  overflow: visible;
}

.amll-lyrics-container:has(.FmKaba_rubyWord > span),
:deep(.amll-lyric-player:has(.FmKaba_rubyWord > span)),
:deep(.amll-lyric-player:has(.FmKaba_rubyWord > span) .FmKaba_lyricMainLine),
:deep(.amll-lyric-player:has(.FmKaba_rubyWord > span) .FmKaba_wordWithRuby),
:deep(.amll-lyric-player:has(.FmKaba_rubyWord > span) .FmKaba_rubyWord) {
  overflow: visible !important;
  contain: none !important;
}

:deep(.amll-lyric-player:has(.FmKaba_rubyWord > span)) {
  mix-blend-mode: normal !important;
}

:deep(.lp-line.lp-credit) {
  position: absolute !important;
  left: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding-top: 0.5em !important;
  padding-left: var(--lyric-line-padding-x, 1em) !important;
  padding-right: var(--lyric-line-padding-x, 1em) !important;
  text-align: left !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  font-size: inherit !important;
  line-height: 1.4 !important;
  pointer-events: auto !important;
  z-index: 10 !important;
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
  contain: none !important;
  overflow: visible !important;
}

:deep(.lp-line.lp-credit:hover),
:deep(.lp-line.lp-credit:active),
:deep([class*="bottomLine"]),
:deep([class*="bottomLine"]:hover),
:deep([class*="bottomLine"]:active) {
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
}

@media (max-width: 990px) {
  :deep(.lp-line.lp-credit) {
    padding-left: var(--lyric-line-padding-x, 1em) !important;
    padding-right: var(--lyric-line-padding-x, 1em) !important;
  }
}
</style>
