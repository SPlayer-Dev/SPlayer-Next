<script setup lang="ts">
/**
 * 雾气背景层
 * 参照 BetterLyrics 的 FogRenderer，使用 Canvas 2D 绘制流动雾气
 * 多个柔和椭圆 blob 缓慢漂移叠加，颜色取自封面主色调
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

/** 雾气 blob 数量上限 */
const FOG_BLOB_COUNT = 6;

interface FogBlob {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
  alpha: number;
}

const blobs = shallowRef<FogBlob[]>([]);

/** 初始化雾气 blob */
const initBlobs = (): void => {
  const result: FogBlob[] = [];
  for (let i = 0; i < FOG_BLOB_COUNT; i++) {
    result.push({
      x: 0.1 + Math.random() * 0.8,
      y: 0.1 + Math.random() * 0.8,
      radiusX: 0.3 + Math.random() * 0.25,
      radiusY: 0.2 + Math.random() * 0.15,
      speedX: 0.00008 + Math.random() * 0.00012,
      speedY: 0.00006 + Math.random() * 0.0001,
      phaseX: i * 1.7 + Math.random(),
      phaseY: i * 2.3 + Math.random(),
      alpha: 0.12 + Math.random() * 0.1,
    });
  }
  blobs.value = result;
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

  const color = props.dominantColor ?? { r: 200, g: 200, b: 220 };
  const { r, g, b } = color;

  ctx.globalCompositeOperation = "screen";
  const currentBlobs = blobs.value;
  for (const blob of currentBlobs) {
    const bx = (blob.x + Math.sin(timestamp * blob.speedX + blob.phaseX) * 0.2) * w;
    const by = (blob.y + Math.cos(timestamp * blob.speedY + blob.phaseY) * 0.15) * h;
    const rx = blob.radiusX * w;
    const ry = blob.radiusY * h;

    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(rx, ry));
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${blob.alpha})`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${blob.alpha * 0.4})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.translate(-bx, -by);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
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
  initBlobs();
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
  <canvas ref="canvasRef" class="fog-background" />
</template>

<style scoped>
.fog-background {
  position: absolute;
  inset: 0;
  filter: blur(40px);
  pointer-events: none;
}
</style>
