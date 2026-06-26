<script setup lang="ts">
import { useIslandSpectrum } from "../composables/useSpectrum";
import type { IslandSpectrumStyle } from "@shared/types/settings";

interface Props {
  width?: number;
  height?: number;
  barWidth?: number;
  barGap?: number;
  maxHeight?: number;
  /** 调色板颜色数组 [primary, secondary, primary] */
  palette?: string[];
  /** 是否正在播放（暂停时频谱塌缩） */
  playing?: boolean;
  /** 频谱样式：gradient 斜向渐变 / solid 纯色 / minimal 极简细线 */
  spectrumStyle?: IslandSpectrumStyle;
  /** 频段数：6（默认）或 10（纯音乐模式） */
  numBands?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: 36,
  height: 28,
  barWidth: 3,
  barGap: 2,
  maxHeight: 28,
  palette: () => ["rgba(255, 255, 255, 0.9)", "rgba(255, 255, 255, 0.5)", "rgba(255, 255, 255, 0.9)"],
  playing: true,
  spectrumStyle: "gradient",
  numBands: 6,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const { draw, reset } = useIslandSpectrum(props.numBands);

let rafId = 0;

const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${props.width}px`;
  canvas.style.height = `${props.height}px`;
  canvas.width = Math.round(props.width * dpr);
  canvas.height = Math.round(props.height * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const drawFrame = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  draw({
    ctx,
    width: props.width,
    height: props.height,
    barWidth: props.barWidth,
    barGap: props.barGap,
    maxHeight: props.maxHeight,
    palette: props.palette,
    playing: props.playing,
    spectrumStyle: props.spectrumStyle,
  });
  rafId = requestAnimationFrame(drawFrame);
};

const startLoop = (): void => {
  if (rafId === 0) {
    rafId = requestAnimationFrame(drawFrame);
  }
};

const stopLoop = (): void => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
};

/* 窗口隐藏时暂停 RAF，避免不可见时浪费 CPU 与 GPU */
const handleVisibilityChange = (): void => {
  if (document.hidden) {
    stopLoop();
  } else {
    startLoop();
  }
};

onMounted(() => {
  resizeCanvas();
  startLoop();
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopLoop();
  reset();
});

watch(() => [props.width, props.height], resizeCanvas);
</script>

<template>
  <canvas ref="canvasRef" class="island-spectrum" />
</template>

<style scoped>
.island-spectrum {
  display: block;
  flex-shrink: 0;
}
</style>
