<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { LyricPlayer as CoreLyricPlayer } from "@applemusic-like-lyrics/core";
import { useSettingsStore } from "@/stores/settings";
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
const wrapperRef = ref<HTMLDivElement | null>(null);
const playerRef = ref<CoreLyricPlayer>();
const bottomLineEl = ref<HTMLElement>();

// 是否被父组件冻结
const isFrozen = ref(false);
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;

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

const { resume: resumeRaf, pause: pauseRaf } = useRafFn(
  ({ delta }) => {
    playerRef.value?.update(delta);
  },
  { immediate: false },
);

// 页面隐藏时停止渲染循环
const handleVisibility = () => {
  if (document.hidden) {
    pauseRaf();
    playerRef.value?.pause();
  } else if (!isFrozen.value) {
    if (props.playing) {
      playerRef.value?.resume();
    } else {
      playerRef.value?.pause();
    }
    resumeRaf();
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

  // 应用初始状态
  if (props.initialTime > 0) {
    playerRef.value.setCurrentTime(props.initialTime);
  }
  if (processedLyrics.value.length > 0) {
    playerRef.value.setLyricLines(processedLyrics.value);
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

// 播放/暂停/冻结状态变化时同步渲染循环与 Core 内部时钟
watchEffect(() => {
  const player = playerRef.value;
  if (!player) return;
  if (!isFrozen.value && !document.hidden) {
    if (props.playing) {
      player.resume();
    } else {
      player.pause();
    }
    resumeRaf();
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
    playerRef.value.setLyricLines(newLyrics);
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
