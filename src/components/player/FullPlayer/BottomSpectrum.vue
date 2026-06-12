<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { getFftFrame } from "@/services/playback";

interface Props {
  /** 是否处于活跃状态 */
  show?: boolean;
  /** 高度（px），默认 80 */
  height?: number;
  /** bar 圆角（px），默认 2 */
  radius?: number;
  /** 最大画布宽度（px），默认 1920 */
  maxWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  show: true,
  height: 80,
  radius: 2,
  maxWidth: 1920,
});

const status = useStatusStore();
const settings = useSettingsStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);

/** 后端推送数据长度 */
const FFT_SIZE = 128;
/** 极低频跳过的段数（噪声多） */
const SKIP_LOW = 8;
/** bar 之间的固定间隙（px） */
const BAR_GAP = 3;
/** 后端推送间隔（ms），用于时间插值 */
const PUSH_INTERVAL = 50;

/** 上一帧推送数据 */
const prev = new Float32Array(FFT_SIZE);
/** 当前帧推送数据 */
const curr = new Float32Array(FFT_SIZE);
/** 实际渲染显示值（经过指数平滑） */
const display = new Float32Array(FFT_SIZE);
/** 上一次推送数据的引用，用于检测新帧到达 */
let lastRef: readonly number[] = [];
/** 上一次推送到达的时间戳 */
let lastUpdate = 0;

/** 调整画布大小 */
const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.min(document.body.clientWidth, props.maxWidth);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${props.height}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(props.height * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

/** 绘制频谱 */
const draw = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 检测新帧推送
  const data = getFftFrame();
  if (data !== lastRef) {
    lastRef = data;
    prev.set(curr);
    for (let i = 0; i < FFT_SIZE; i++) curr[i] = data[i] ?? 0;
    lastUpdate = performance.now();
  }

  // 时间插值：在 prev → curr 之间按时间平滑过渡，消除 20Hz stair-step
  const t = Math.min((performance.now() - lastUpdate) / PUSH_INTERVAL, 1);
  // 上行快（响应灵敏），下行慢（视觉柔和）
  const ATTACK = 0.4;
  const DECAY = 0.88;

  for (let i = 0; i < FFT_SIZE; i++) {
    const target = prev[i] + (curr[i] - prev[i]) * t;
    if (target > display[i]) {
      display[i] = display[i] + (target - display[i]) * ATTACK;
    } else {
      display[i] = display[i] * DECAY + target * (1 - DECAY);
    }
  }

  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const usableLen = FFT_SIZE - SKIP_LOW;
  const barWidth = Math.max(1, settings.player.spectrumBarWidth);
  const slotWidth = barWidth + BAR_GAP;
  // 一侧能放下的 bar 数；不再限制 ≤ usableLen，允许过采样（多个相邻 bar 共用一个 bin 的均值）
  const numBars = Math.floor(cssWidth / 2 / slotWidth);
  if (numBars === 0) return;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = getComputedStyle(canvas).color;

  const halfWidth = cssWidth / 2;
  for (let i = 0; i < numBars; i++) {
    // 每个 bar 覆盖一段 bin，再扩 1 个邻居做空间平滑，避免相邻 bin 方差导致的悬崖
    const startBin = SKIP_LOW + Math.floor((i * usableLen) / numBars);
    const endBin = SKIP_LOW + Math.floor(((i + 1) * usableLen) / numBars);
    const lo = Math.max(SKIP_LOW, startBin - 1);
    const hi = Math.min(FFT_SIZE, Math.max(endBin, startBin + 1) + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += display[j];
    const v = sum / (hi - lo);

    const barHeight = v * cssHeight;
    if (barHeight <= 0.5) continue;
    const y = cssHeight - barHeight;
    const xRight = halfWidth + i * slotWidth;
    const xLeft = halfWidth - (i + 1) * slotWidth;
    ctx.beginPath();
    ctx.roundRect(xRight, y, barWidth, barHeight, props.radius);
    ctx.roundRect(xLeft, y, barWidth, barHeight, props.radius);
    ctx.fill();
  }
};

const { resume, pause } = useRafFn(draw, { immediate: false });

const startCapture = (): void => {
  window.api.player.setFftEnabled(true);
  resume();
};

const stopCapture = (): void => {
  pause();
  window.api.player.setFftEnabled(false);
};

// 暂停时停止 FFT 推送 + RAF 重绘
watch(
  () => status.isPlaying,
  (playing) => {
    if (playing) startCapture();
    else stopCapture();
  },
  { immediate: true },
);

onMounted(() => {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  stopCapture();
  prev.fill(0);
  curr.fill(0);
  display.fill(0);
  lastRef = [];
});
</script>

<template>
  <div
    class="absolute left-0 bottom-0 w-full flex justify-center z-0 pointer-events-none transition-opacity duration-300"
    :style="{ opacity: show ? 0.65 : 0.15 }"
  >
    <canvas ref="canvasRef" class="spectrum-canvas" />
  </div>
</template>

<style scoped>
.spectrum-canvas {
  mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 12%,
    #fff 88%,
    hsla(0, 0%, 100%, 0.6) 95%,
    hsla(0, 0%, 100%, 0)
  );
}
</style>
