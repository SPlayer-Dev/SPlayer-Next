<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { LyricPlayer as CoreLyricPlayer } from "@applemusic-like-lyrics/core";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime } from "@/services/playback";
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
const bottomLineEl = ref<HTMLElement>();
const clockInitialized = ref(false);
// 父组件的冻结标志（由 FullPlayer 的 freeze/resume 控制）
const isFrozen = ref(false);
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;
// 页面隐藏状态的响应式跟踪
const isPageHidden = ref(false);
// 之前隐藏的标记，用于检测从隐藏恢复的时刻
const isPreviousHidden = ref(false);

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

onMounted(() => {
  if (!wrapperRef.value) return;
  // 创建 AMLL Core 歌词播放器实例
  playerRef.value = new CoreLyricPlayer();

  // 挂载到容器中
  const el = playerRef.value.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  wrapperRef.value.appendChild(el);

  // 获取底栏 DOM 节点
  const bottomEl = playerRef.value.getBottomLineElement();
  if (bottomEl) {
    bottomEl.classList.add("lp-line", "lp-credit");
    bottomLineEl.value = bottomEl;
  }

  // 绑定行点击事件
  playerRef.value.addEventListener("line-click", handleLineClick);

  if (processedLyrics.value.length > 0) {
    playerRef.value.setLyricLines(processedLyrics.value, props.initialTime);
    processLyricLanguage();
  } else if (Number.isFinite(props.initialTime) && props.initialTime >= 0) {
    playerRef.value.setCurrentTime(props.initialTime, true);
  }

  document.addEventListener("visibilitychange", handleVisibility);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
  pauseRaf();
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
  if (!player) return;

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

// 监听其他配置项变动并同步到底层 Core 实例
watchEffect(() => {
  if (playerRef.value) {
    playerRef.value.setAlignPosition(props.alignPosition);
    playerRef.value.setAlignAnchor(props.alignPosition > 0.4 ? "center" : "top");
    playerRef.value.setWordFadeWidth(props.wordFadeWidth);
    playerRef.value.setHidePassedLines(props.hidePassedLines);
    playerRef.value.setEnableBlur(props.enableBlur);

    const useSpring = settings.lyric.useAMSpring;
    playerRef.value.setEnableSpring(useSpring);
    playerRef.value.setEnableScale(useSpring);

    playerRef.value.setLinePosYSpringParams({
      mass: settings.lyric.amllVerticalSpringMass,
      damping: settings.lyric.amllVerticalSpringDamping,
      stiffness: settings.lyric.amllVerticalSpringStiffness,
      soft: settings.lyric.amllVerticalSpringSoft,
    });
    playerRef.value.setLineScaleSpringParams({
      mass: settings.lyric.amllScaleSpringMass,
      damping: settings.lyric.amllScaleSpringDamping,
      stiffness: settings.lyric.amllScaleSpringStiffness,
      soft: settings.lyric.amllScaleSpringSoft,
    });
  }
});

// 监听处理完的歌词数据变动
watch(processedLyrics, (newLyrics) => {
  if (!playerRef.value) return;
  if (isFrozen.value) {
    pendingLyrics = newLyrics;
  } else {
    playerRef.value.setLyricLines(newLyrics, props.initialTime);
    processLyricLanguage();
  }
});

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
  if (pendingLyrics) {
    playerRef.value?.setLyricLines(pendingLyrics);
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
  <div ref="wrapperRef" class="amll-lyrics-container" />
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
