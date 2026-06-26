<script setup lang="ts">
/**
 * 流体背景
 * 参照 BetterLyrics 的动态背景效果，使用 Canvas 2D 绘制流动色块
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  dominantColor?: RGB | null;
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
  palette: () => [],
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let visible = true;

/** 色块定义 */
interface Blob {
  x: number;
  y: number;
  radius: number;
  color: RGB;
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
}

const blobs = shallowRef<Blob[]>([]);

/** 初始化色块 */
const initBlobs = (): void => {
  const colors = props.palette.length >= 3
    ? props.palette.slice(0, 4)
    : props.dominantColor
      ? [props.dominantColor, props.dominantColor, props.dominantColor]
      : [{ r: 30, g: 30, b: 50 }, { r: 20, g: 20, b: 40 }, { r: 40, g: 25, b: 45 }];

  const result: Blob[] = colors.map((color, i) => ({
    x: 0.2 + Math.random() * 0.6,
    y: 0.2 + Math.random() * 0.6,
    radius: 0.25 + Math.random() * 0.2,
    color,
    speedX: 0.0003 + Math.random() * 0.0005,
    speedY: 0.0003 + Math.random() * 0.0005,
    phaseX: i * 1.7 + Math.random(),
    phaseY: i * 2.3 + Math.random(),
  }));
  blobs.value = result;
};

/** 绘制帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas || !visible) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 清空
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgb(18, 18, 18)";
  ctx.fillRect(0, 0, w, h);

  // 绘制色块
  const currentBlobs = blobs.value;
  for (const blob of currentBlobs) {
    const bx = (blob.x + Math.sin(timestamp * blob.speedX + blob.phaseX) * 0.15) * w;
    const by = (blob.y + Math.cos(timestamp * blob.speedY + blob.phaseY) * 0.15) * h;
    const br = blob.radius * Math.min(w, h);

    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const { r, g, b } = blob.color;
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.2)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  // 暗色遮罩
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, w, h);

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

watch([() => props.dominantColor, () => props.palette], () => {
  initBlobs();
}, { deep: true });

onMounted(() => {
  initBlobs();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) {
      rafId = requestAnimationFrame(draw);
    }
  });
  rafId = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <canvas ref="canvasRef" class="fluid-background" />
</template>

<style scoped>
.fluid-background {
  position: absolute;
  inset: 0;
  filter: blur(60px);
  pointer-events: none;
}
</style>
