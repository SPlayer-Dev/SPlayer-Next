<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { LyricRenderer } from "./engine";
import type { SpringParams } from "./engine/spring";
import { DEFAULTS } from "./engine/constants";
import "./renderer.css";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 是否正在播放（默认 true） */
    playing?: boolean;
    /**
     * 激活行在容器中的对齐位置
     * @range 0 ~ 1（0 = 顶部，1 = 底部）
     * @default 0.35
     */
    alignPosition?: number;
    /**
     * 逐字掩码渐变宽度比例（相对于文字高度）
     * @range 0 ~ 1（0 = 硬切，1 = 全字高渐变）
     * @default 0.5
     */
    wordFadeWidth?: number;
    /** 弹簧物理参数（mass / damping / stiffness / soft） */
    springConfig?: Partial<SpringParams>;
    /**
     * 用户滚动后自动回弹到激活行的延迟时间
     * @unit 毫秒
     * @default 5000
     */
    scrollResetDelay?: number;
    /**
     * 触发间奏圆点动画的最小间隔时长
     * @unit 毫秒
     * @default 4000
     */
    minInterludeGap?: number;
    /**
     * 间奏圆点呼吸动画的目标周期
     * @unit 毫秒
     * @default 1500
     */
    breatheCycleTarget?: number;
    /**
     * 透明度增加速度（行被激活时）
     * @range 值越大过渡越快
     * @default 50
     */
    alphaAttackSpeed?: number;
    /**
     * 透明度衰减速度（行取消激活时）
     * @range 值越大过渡越快
     * @default 7
     */
    alphaReleaseSpeed?: number;
    /**
     * 非激活行的基础透明度
     * @range 0 ~ 1（0 = 完全透明，1 = 不透明）
     * @default 0.2
     */
    inactiveAlpha?: number;
    /**
     * 是否隐藏已播放行
     * @default false
     */
    hidePassedLines?: boolean;
    /**
     * 是否启用逐行模糊效果
     * @default false
     */
    enableBlur?: boolean;
    /**
     * 是否启用逐字高亮效果
     * @default true
     */
    enableWordHighlight?: boolean;
    /**
     * 是否启用逐字上浮动画
     * @default false
     */
    enableFloatAnimation?: boolean;
    /**
     * 是否启用强调效果（缩放 + 辉光 + 正弦浮动）
     * @default false
     */
    enableEmphasizeEffect?: boolean;
    /** 是否显示翻译歌词 @default true */
    showTranslation?: boolean;
    /** 是否显示音译歌词 @default true */
    showRomanization?: boolean;
    /** 挂载时的初始播放时间（毫秒）@default 0 */
    initialTime?: number;
  }>(),
  {
    playing: false,
    alignPosition: DEFAULTS.alignPosition,
    wordFadeWidth: DEFAULTS.wordFadeWidth,
    scrollResetDelay: DEFAULTS.scrollResetDelay,
    minInterludeGap: DEFAULTS.minInterludeGap,
    breatheCycleTarget: DEFAULTS.breatheCycleTarget,
    alphaAttackSpeed: DEFAULTS.alphaAttackSpeed,
    alphaReleaseSpeed: DEFAULTS.alphaReleaseSpeed,
    inactiveAlpha: DEFAULTS.inactiveAlpha,
    hidePassedLines: DEFAULTS.hidePassedLines,
    enableBlur: DEFAULTS.enableBlur,
    enableWordHighlight: DEFAULTS.enableWordHighlight,
    enableFloatAnimation: DEFAULTS.enableFloatAnimation,
    enableEmphasizeEffect: DEFAULTS.enableEmphasizeEffect,
    showTranslation: true,
    showRomanization: true,
    initialTime: 0,
  },
);

interface Emits {
  /** 用户点击歌词行时触发，参数为该行起始时间（毫秒），用于跳转播放进度 */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const containerRef = ref<HTMLElement>();
let renderer: LyricRenderer | null = null;
/** 冻结状态标志 */
let isFrozen = false;
/** 冻结期间收到的待应用歌词（父容器 display:none 时无法测量，需延迟） */
let pendingLyrics: LyricLine[] | null = null;

/**
 * 推送当前播放时间（毫秒）
 *
 * 由外部播放器在每帧或定时器中调用，驱动歌词滚动与逐字高亮动画。
 *
 * @param time - 当前播放时间（毫秒）
 */
const setCurrentTime = (time: number) => {
  renderer?.setCurrentTime(time);
};

const freeze = () => {
  isFrozen = true;
  renderer?.freeze();
};
const resume = () => {
  isFrozen = false;
  // 应用冻结期间缓冲的歌词变更
  if (pendingLyrics) {
    renderer?.setLyrics(pendingLyrics);
    pendingLyrics = null;
  }
  renderer?.resume();
};

defineExpose({ setCurrentTime, freeze, resume });

const handleLineClick = (timeMs: number) => {
  emit("seek", timeMs);
};

onMounted(() => {
  if (!containerRef.value) return;
  const { lyricLines: _lyricLines, initialTime: _initialTime, ...config } = props;
  renderer = new LyricRenderer(containerRef.value, {
    ...config,
    springConfig: props.springConfig ?? {},
    onLineClick: handleLineClick,
  });
  if (props.initialTime > 0) {
    renderer.setCurrentTime(props.initialTime);
  }
  if (props.lyricLines.length > 0) {
    renderer.setLyrics(props.lyricLines);
  }
});

onUnmounted(() => {
  renderer?.dispose();
  renderer = null;
});

watch(
  () => props.lyricLines,
  (lines) => {
    if (isFrozen) {
      // 冻结时缓冲，避免在 display:none 下测量尺寸
      pendingLyrics = lines;
    } else {
      renderer?.setLyrics(lines);
    }
  },
);

watch(
  () => props.playing,
  (v) => renderer?.setPlaying(v),
);

watch(
  () => props.alignPosition,
  (v) => renderer?.setConfig({ alignPosition: v }),
);

watch(
  () => props.wordFadeWidth,
  (v) => renderer?.setConfig({ wordFadeWidth: v }),
);

watch(
  () => props.springConfig,
  (v) => {
    if (v) renderer?.setConfig({ springConfig: v });
  },
  { deep: true },
);

watch(
  () => props.scrollResetDelay,
  (v) => renderer?.setConfig({ scrollResetDelay: v }),
);

watch(
  () => props.minInterludeGap,
  (v) => renderer?.setConfig({ minInterludeGap: v }),
);

watch(
  () => props.breatheCycleTarget,
  (v) => renderer?.setConfig({ breatheCycleTarget: v }),
);

watch(
  () => props.alphaAttackSpeed,
  (v) => renderer?.setConfig({ alphaAttackSpeed: v }),
);

watch(
  () => props.alphaReleaseSpeed,
  (v) => renderer?.setConfig({ alphaReleaseSpeed: v }),
);

watch(
  () => props.inactiveAlpha,
  (v) => renderer?.setConfig({ inactiveAlpha: v }),
);

watch(
  () => props.hidePassedLines,
  (v) => renderer?.setConfig({ hidePassedLines: v }),
);

watch(
  () => props.enableBlur,
  (v) => renderer?.setConfig({ enableBlur: v }),
);

watch(
  () => props.enableWordHighlight,
  (v) => renderer?.setConfig({ enableWordHighlight: v }),
);

// 上浮/强调开关变化需要重建 DOM（影响 span 结构和动画创建）
watch(
  () => props.enableFloatAnimation,
  (v) => {
    renderer?.setConfig({ enableFloatAnimation: v });
    renderer?.setLyrics(props.lyricLines);
  },
);

watch(
  () => props.enableEmphasizeEffect,
  (v) => {
    renderer?.setConfig({ enableEmphasizeEffect: v });
    renderer?.setLyrics(props.lyricLines);
  },
);

// 翻译/音译开关变化需要重建 DOM（影响 sub 行的创建）
watch(
  () => props.showTranslation,
  (v) => {
    renderer?.setConfig({ showTranslation: v });
    renderer?.setLyrics(props.lyricLines);
  },
);

watch(
  () => props.showRomanization,
  (v) => {
    renderer?.setConfig({ showRomanization: v });
    renderer?.setLyrics(props.lyricLines);
  },
);
</script>

<template>
  <div ref="containerRef" />
</template>
