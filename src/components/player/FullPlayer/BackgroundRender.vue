<script setup lang="ts">
import {
  type AbstractBaseRenderer,
  type BaseRenderer,
  BackgroundRender as CoreBackgroundRender,
  MeshGradientRenderer,
} from "@applemusic-like-lyrics/core";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";

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
  /** 是否随低频节拍脉动（默认 false，关闭则不采集 FFT） */
  enableBeat?: boolean;
  /** 渲染器类，默认为 MeshGradientRenderer */
  renderer?: new (...args: ConstructorParameters<typeof BaseRenderer>) => BaseRenderer;
}

const props = withDefaults(defineProps<BackgroundRenderProps>(), {
  playing: true,
  flowSpeed: 2,
  hasLyric: true,
  fps: 30,
  renderScale: 0.5,
  enableBeat: false,
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

  // 提取低频部分（前 4 段，对数映射下约 80 - 90Hz，即低音鼓/贝斯基频区）
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

const { resume: resumeFftLoop, pause: pauseFftLoop } = useRafFn(updateLowFreqVolume, {
  immediate: false,
});

// 本地持有标记，保证 acquire / release 严格配对
let fftAcquired = false;

/**
 * 开始捕获 FFT 频谱数据
 */
const startFftCapture = () => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  resumeFftLoop();
};

/**
 * 停止捕获 FFT 频谱数据
 */
const stopFftCapture = () => {
  pauseFftLoop();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

/**
 * 按播放状态与跳动开关同步 FFT 采集：仅在播放中且开启跳动时采集，
 * 否则停止采集并把低频音量复位为 1.0（不脉动）
 */
const syncFftCapture = () => {
  if (props.playing && props.enableBeat) {
    startFftCapture();
  } else {
    stopFftCapture();
    smoothedVolume = 0;
    bgRenderRef.value?.setLowFreqVolume(1.0);
  }
};

onMounted(() => {
  if (!wrapperRef.value) return;

  // 初始化 AMLL 底层渲染器
  bgRenderRef.value = CoreBackgroundRender.new(props.renderer);

  // 设置 Canvas 自适应容器并附着 DOM
  const el = bgRenderRef.value.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.display = "block";
  wrapperRef.value.appendChild(el);

  updateRendererState();
  syncFftCapture();
});

onBeforeUnmount(() => {
  stopFftCapture();

  const renderer = bgRenderRef.value;
  if (renderer) {
    // 同步释放底层 Canvas 与 WebGL 上下文，避免上下文泄漏
    renderer.pause();
    renderer.dispose();
    bgRenderRef.value = undefined;
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
      if (isPlaying) bgRenderRef.value.resume();
      else bgRenderRef.value.pause();
    }
    syncFftCapture();
  },
);

watch(
  () => props.enableBeat,
  () => syncFftCapture(),
);

watch(
  () => props.fps,
  (val) => {
    bgRenderRef.value?.setFPS(val);
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
  <div ref="wrapperRef" class="background-render-wrapper" aria-hidden="true" />
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
