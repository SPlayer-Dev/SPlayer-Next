<script setup lang="ts">
/**
 * 雪花背景层
 * 参照 BetterLyrics 的 SnowRenderer，使用 Canvas 2D 绘制雪花粒子
 * 雪花从顶部下落，带横向漂移，颜色取自封面调色板
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  palette: () => [],
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let visible = true;

/** 雪花粒子数量上限，避免无界增长 */
const SNOWFLAKE_COUNT = 80;

interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  phase: number;
}

const snowflakes = shallowRef<Snowflake[]>([]);

/** 初始化雪花粒子 */
const initSnowflakes = (): void => {
  const result: Snowflake[] = [];
  for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
    result.push({
      x: Math.random(),
      y: Math.random(),
      radius: 1 + Math.random() * 3,
      speed: 0.0002 + Math.random() * 0.0005,
      drift: 0.0001 + Math.random() * 0.0003,
      phase: Math.random() * Math.PI * 2,
    });
  }
  snowflakes.value = result;
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

  const color = props.palette[0] ?? { r: 255, g: 255, b: 255 };
  const flakes = snowflakes.value;
  for (const flake of flakes) {
    const x = (flake.x + Math.sin(timestamp * flake.drift + flake.phase) * 0.05) * w;
    const y = ((flake.y + timestamp * flake.speed) % 1) * h;
    ctx.beginPath();
    ctx.arc(x, y, flake.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
    ctx.fill();
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
  initSnowflakes();
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
  <canvas ref="canvasRef" class="snow-background" />
</template>

<style scoped>
.snow-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
