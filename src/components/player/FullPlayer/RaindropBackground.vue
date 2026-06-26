<script setup lang="ts">
/**
 * 雨滴背景层
 * 参照 BetterLyrics 的 RaindropRenderer，使用 Canvas 2D 绘制倾斜雨滴
 * 雨滴从顶部斜向下落，颜色取自封面主色调
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  dominantColor?: RGB | null;
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let visible = true;

/** 雨滴数量上限 */
const RAINDROP_COUNT = 120;
/** 雨滴倾斜角度（弧度） */
const TILT_ANGLE = 0.25;
/** 雨滴长度范围（px） */
const MIN_LENGTH = 12;
const MAX_LENGTH = 28;
/** 雨滴速度范围（每秒占容器高度比例） */
const MIN_SPEED = 0.6;
const MAX_SPEED = 1.4;

interface Raindrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
}

const raindrops = shallowRef<Raindrop[]>([]);

/** 初始化雨滴 */
const initRaindrops = (): void => {
  const result: Raindrop[] = [];
  for (let i = 0; i < RAINDROP_COUNT; i++) {
    result.push({
      x: Math.random(),
      y: Math.random(),
      length: MIN_LENGTH + Math.random() * (MAX_LENGTH - MIN_LENGTH),
      speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
      alpha: 0.2 + Math.random() * 0.4,
    });
  }
  raindrops.value = result;
};

/** 绘制单帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas || !visible) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const color = props.dominantColor ?? { r: 180, g: 200, b: 230 };
  const { r, g, b } = color;

  const dx = Math.sin(TILT_ANGLE);
  const dy = Math.cos(TILT_ANGLE);
  const speedFactor = timestamp * 0.001;

  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, w * 0.0008);
  const drops = raindrops.value;
  for (const drop of drops) {
    const startY = ((drop.y + speedFactor * drop.speed) % 1.2 - 0.2) * h;
    const startX = (drop.x + (startY / h) * Math.tan(TILT_ANGLE) * 0.5) * w;
    const endX = startX - dx * drop.length;
    const endY = startY - dy * drop.length;

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${drop.alpha})`;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  rafId = requestAnimationFrame(draw);
};

/** 调整 Canvas 尺寸 */
const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = parent.clientWidth * dpr;
  canvas.height = parent.clientHeight * dpr;
  canvas.style.width = `${parent.clientWidth}px`;
  canvas.style.height = `${parent.clientHeight}px`;
};

onMounted(() => {
  initRaindrops();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) rafId = requestAnimationFrame(draw);
  });
  rafId = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <canvas ref="canvasRef" class="raindrop-background" />
</template>

<style scoped>
.raindrop-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
