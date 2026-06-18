<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, onUnmounted } from "vue";
import { useRafFn } from "@vueuse/core";
import {
  type AbstractBaseRenderer,
  type BaseRenderer,
  BackgroundRender as CoreBackgroundRender,
  MeshGradientRenderer,
} from "@applemusic-like-lyrics/core";
import { getFftFrame } from "@/services/playback";

export interface BackgroundRenderProps {
  /** 专辑封面资源 URL */
  album?: string;
  /** 是否处于播放状态，默认为 true */
  playing?: boolean;
  /** 动画流动速度，默认为 2 */
  flowSpeed?: number;
  /** 是否有歌词，默认为 true */
  hasLyric?: boolean;
  /** 帧率，默认为 30 */
  fps?: number;
  /** 渲染缩放比例，默认为 0.5 */
  renderScale?: number;
  /** 渲染器类，默认为 MeshGradientRenderer */
  renderer?: new (...args: ConstructorParameters<typeof BaseRenderer>) => BaseRenderer;
}

const props = withDefaults(defineProps<BackgroundRenderProps>(), {
  playing: true,
  flowSpeed: 2,
  hasLyric: true,
  fps: 30,
  renderScale: 0.5,
  renderer: () => MeshGradientRenderer,
});

const wrapperRef = ref<HTMLDivElement | null>(null);

// 外部渲染器实例引用
const bgRenderRef = shallowRef<AbstractBaseRenderer>();

/**
 * 统一同步更新属性状态到底层渲染器
 */
const updateRendererState = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  if (props.album) {
    renderer.setAlbum(props.album, false);
  }
  renderer.setFPS(props.fps);
  renderer.setFlowSpeed(props.flowSpeed);
  renderer.setRenderScale(props.renderScale);
  renderer.setHasLyric(props.hasLyric);

  if (props.playing) {
    renderer.resume();
  } else {
    renderer.pause();
  }
};

// 低频平滑后音量
let smoothedVolume = 0;

/**
 * 从最新 FFT 帧数据计算低频音量能量值 [0.0 - 1.0]
 */
const updateLowFreqVolume = () => {
  const data = getFftFrame();
  if (!data || data.length === 0) return;

  // 提取低频部分 (前 4 个 bin，约 0 - 150Hz)
  const lowBins = data.slice(0, 4);
  const sum = lowBins.reduce((acc, val) => acc + val, 0);
  const avg = sum / lowBins.length;

  // 映射与幂扩展动态范围
  const threshold = 0.05;
  const normalized = Math.max(0, (avg - threshold) / (1.0 - threshold));
  const rawValue = Math.pow(normalized, 1.5);

  // EMA 平滑处理，提供自然的过渡律动
  const smoothFactor = 0.2;
  smoothedVolume = smoothedVolume + smoothFactor * (rawValue - smoothedVolume);

  bgRenderRef.value?.setLowFreqVolume(smoothedVolume);
};

// 使用 VueUse 提供的 useRafFn 帧刷新函数，避免内存占用并配合 playing 状态自动暂停
const { resume: resumeFftLoop, pause: pauseFftLoop } = useRafFn(updateLowFreqVolume, {
  immediate: false,
});

/**
 * 开始捕获 FFT 频谱数据
 */
const startFftCapture = () => {
  if (window.api?.player?.setFftEnabled) {
    window.api.player.setFftEnabled(true);
  }
  resumeFftLoop();
};

/**
 * 停止捕获 FFT 频谱数据
 */
const stopFftCapture = () => {
  pauseFftLoop();
  if (window.api?.player?.setFftEnabled) {
    window.api.player.setFftEnabled(false);
  }
};

onMounted(() => {
  if (wrapperRef.value) {
    // 初始化 AMLL 底层渲染器
    bgRenderRef.value = CoreBackgroundRender.new(props.renderer);
    
    // 设置 Canvas 自适应容器并附着 DOM
    const el = bgRenderRef.value.getElement();
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.display = "block";
    wrapperRef.value.appendChild(el);

    updateRendererState();

    if (props.playing) {
      startFftCapture();
    }
  }
});

let disposeTimer: ReturnType<typeof setTimeout> | null = null;

onBeforeUnmount(() => {
  stopFftCapture();

  const renderer = bgRenderRef.value;
  if (renderer) {
    renderer.pause();
    bgRenderRef.value = undefined;

    // 延迟 500ms 销毁底层 Canvas 与 WebGL 上下文，以配合过渡动画，避免发生闪烁和内存泄漏
    disposeTimer = setTimeout(() => {
      renderer.dispose();
      disposeTimer = null;
    }, 500);
  }
});

onUnmounted(() => {
  if (disposeTimer) {
    clearTimeout(disposeTimer);
    disposeTimer = null;
  }
});

// 属性变化监听
watch(
  () => props.album,
  (val) => {
    if (val && bgRenderRef.value) {
      bgRenderRef.value.setAlbum(val, false);
    }
  },
);

watch(
  () => props.playing,
  (isPlaying) => {
    if (bgRenderRef.value) {
      if (isPlaying) {
        bgRenderRef.value.resume();
        startFftCapture();
      } else {
        bgRenderRef.value.pause();
        stopFftCapture();
      }
    }
  },
);

watch(
  () => props.flowSpeed,
  (val) => {
    bgRenderRef.value?.setFlowSpeed(val);
  },
);

watch(
  () => props.renderScale,
  (val) => {
    bgRenderRef.value?.setRenderScale(val);
  },
);

watch(
  () => props.hasLyric,
  (val) => {
    bgRenderRef.value?.setHasLyric(val);
  },
);

defineExpose({
  bgRender: bgRenderRef,
  wrapperEl: wrapperRef,
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="background-render-wrapper"
    aria-hidden="true"
  />
</template>

<style scoped>
.background-render-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
</style>
