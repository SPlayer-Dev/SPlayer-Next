<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, onUnmounted } from "vue";
import type { LyricLine } from "@shared/types/lyrics";
import { LyricPlayer as CoreLyricPlayer } from "@applemusic-like-lyrics/core";
import { useSettingsStore } from "@/stores/settings";
import "@applemusic-like-lyrics/core/style.css";

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
    /** 是否显示音译歌词 */
    showRomanization?: boolean;
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
    showRomanization: true,
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

// 是否被父组件冻结
let isFrozen = false;
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;

// 处理多语言显隐及音译偏好的本地高效清洗
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  return props.lyricLines.map((line) => {
    const newLine = {
      ...line,
      translatedLyric: props.showTranslation ? line.translatedLyric : "",
      romanLyric: props.showRomanization ? line.romanLyric : "",
    };
    if (line.words) {
      newLine.words = line.words.map((w) => {
        const newWord = { ...w };
        if (!props.showRomanization) {
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
  const amllEvent = e as any;
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
  }
};

onMounted(() => {
  if (wrapperRef.value) {
    // 创建 AMLL Core 歌词播放器实例
    playerRef.value = new CoreLyricPlayer();
    
    // 挂载到容器中
    const el = playerRef.value.getElement();
    el.style.width = "100%";
    el.style.height = "100%";
    wrapperRef.value.appendChild(el);

    // 绑定行点击事件
    playerRef.value.addEventListener("line-click", handleLineClick);

    // 应用初始状态
    if (props.initialTime > 0) {
      playerRef.value.setCurrentTime(props.initialTime);
    }
    if (processedLyrics.value.length > 0) {
      playerRef.value.setLyricLines(processedLyrics.value);
    }
  }
});

onUnmounted(() => {
  if (playerRef.value) {
    playerRef.value.removeEventListener("line-click", handleLineClick);
    playerRef.value.dispose();
    playerRef.value = undefined;
  }
});

// 驱动逐帧渲染动画的核心 loop
watchEffect((onCleanup) => {
  if (props.playing && !isFrozen) {
    let canceled = false;
    let lastTime = performance.now();
    const onFrame = (time: number) => {
      if (canceled) return;
      const deltaTime = time - lastTime;
      lastTime = time;
      playerRef.value?.update(deltaTime);
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    onCleanup(() => {
      canceled = true;
    });
  }
});

// 监听播放/暂停状态
watchEffect(() => {
  if (playerRef.value) {
    if (props.playing && !isFrozen) {
      playerRef.value.resume();
    } else {
      playerRef.value.pause();
    }
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
    
    // 外部高级设置项读取与同步
    const useSpring = (settings.player as any).useAMSpring ?? true;
    playerRef.value.setEnableSpring(useSpring);
    playerRef.value.setEnableScale(useSpring);
  }
});

// 监听处理完的歌词数据变动
watch(
  processedLyrics,
  (newLyrics) => {
    if (!playerRef.value) return;
    if (isFrozen) {
      pendingLyrics = newLyrics;
    } else {
      playerRef.value.setLyricLines(newLyrics);
    }
  },
  { deep: true },
);

// 主播放器事件驱动的时间同步接口
const setCurrentTime = (time: number) => {
  playerRef.value?.setCurrentTime(time);
};

// 隐藏界面或休眠时调用，冻结动画以优化 CPU 占用率
const freeze = () => {
  isFrozen = true;
  playerRef.value?.pause();
};

// 恢复播放和滚动测量
const resume = () => {
  isFrozen = false;
  if (pendingLyrics) {
    playerRef.value?.setLyricLines(pendingLyrics);
    pendingLyrics = null;
  }
  if (props.playing) {
    playerRef.value?.resume();
  }
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
  width: 100%;
  height: 100%;
  padding-left: 10%;
  padding-right: 15%;
  box-sizing: border-box;
}

@media (max-width: 990px) {
  :deep(.amll-lyric-player) {
    padding-left: 20px;
    padding-right: 20px;
  }
}
</style>
