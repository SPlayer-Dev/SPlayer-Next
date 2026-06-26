<script setup lang="ts">
/**
 * 灵动岛背景风格
 * 参照 WinIsland 的 render.rs：solid（纯黑）/ glass（毛玻璃）/ mica（云母）/ dynamic（动态封面模糊）
 * glass/mica 使用 CSS backdrop-filter 模糊桌面背景
 * dynamic 使用 Canvas 绘制封面降采样模糊 + 慢速旋转 + 漂移
 */
import type { IslandBackgroundStyle } from "@shared/types/settings";

interface Props {
  /** 背景风格 */
  backgroundStyle?: IslandBackgroundStyle;
  /** 封面 URL（dynamic 风格使用） */
  coverSrc?: string;
}

const props = withDefaults(defineProps<Props>(), {
  backgroundStyle: "solid",
  coverSrc: "",
});

const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
/** 缓存有效标记 */
let cacheValid = false;
/** 上次绘制使用的封面 URL */
let lastCoverSrc = "";
/** 封面图片缓存 */
let coverImg: HTMLImageElement | null = null;
/** 旋转动画 rAF ID */
let rotateRafId = 0;
/** Canvas 实际尺寸 */
let canvasW = 0;
let canvasH = 0;

/** 加载封面图片 */
const loadCoverImage = (src: string): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
};

/** 绘制动态背景（参照 WinIsland：封面模糊 + 慢速旋转 + 漂移） */
const drawDynamicBackground = async (): Promise<void> => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!coverImg || props.coverSrc !== lastCoverSrc) {
    coverImg = await loadCoverImage(props.coverSrc);
    if (!coverImg) return;
    lastCoverSrc = props.coverSrc;
  }

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  if (canvasW !== w || canvasH !== h) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvasW = w;
    canvasH = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, w, h);

  // 极小尺寸绘制封面，再放大，自然产生模糊效果（参照 WinIsland 64x64 降采样）
  const tinySize = 64;
  const offscreen = document.createElement("canvas");
  offscreen.width = tinySize;
  offscreen.height = tinySize;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.drawImage(coverImg, 0, 0, tinySize, tinySize);

  // 放大到目标尺寸
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(offscreen, 0, 0, w, h);

  // 暗色叠加
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, w, h);

  cacheValid = true;
};

/** 启动慢速旋转动画（参照 WinIsland：60 秒一圈） */
const startRotation = (): void => {
  if (rotateRafId !== 0) return;
  const animate = (): void => {
    if (props.backgroundStyle !== "dynamic" || !canvasRef.value) {
      rotateRafId = 0;
      return;
    }
    // WinIsland 用 canvas.rotate 实现旋转；CSS 方案下用 transform 旋转容器
    // 这里简化处理：仅重绘封面，旋转效果由 CSS animation 实现
    rotateRafId = requestAnimationFrame(animate);
  };
  rotateRafId = requestAnimationFrame(animate);
};

const stopRotation = (): void => {
  if (rotateRafId !== 0) {
    cancelAnimationFrame(rotateRafId);
    rotateRafId = 0;
  }
};

const render = async (): Promise<void> => {
  if (cacheValid) return;

  if (props.backgroundStyle === "solid") {
    cacheValid = true;
    return;
  }

  if (props.backgroundStyle === "dynamic") {
    await drawDynamicBackground();
  }

  cacheValid = true;
};

/** 使缓存失效并重绘 */
const invalidate = (): void => {
  cacheValid = false;
};

watch(() => props.backgroundStyle, () => {
  invalidate();
  render();
});

watch(() => props.coverSrc, (newSrc) => {
  if (props.backgroundStyle === "dynamic" && newSrc !== lastCoverSrc) {
    invalidate();
    render();
  }
});

/** 监听容器尺寸变化，重绘 Canvas */
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  render();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.backgroundStyle === "dynamic") {
        canvasW = 0;
        canvasH = 0;
        invalidate();
        render();
      }
    });
    resizeObserver.observe(containerRef.value);
  }
  if (props.backgroundStyle === "dynamic") {
    startRotation();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopRotation();
  cacheValid = false;
  coverImg = null;
});
</script>

<template>
  <div
    ref="containerRef"
    class="glass-bg"
    :class="[`style-${backgroundStyle}`]"
  >
    <!-- glass 风格：毛玻璃模糊桌面背景 -->
    <div v-if="backgroundStyle === 'glass'" class="glass-layer" />
    <!-- mica 风格：更强模糊 + 云母质感 -->
    <div v-else-if="backgroundStyle === 'mica'" class="mica-layer" />
    <!-- dynamic 风格：Canvas 绘制封面模糊 + 慢速旋转 -->
    <canvas
      v-else-if="backgroundStyle === 'dynamic'"
      ref="canvasRef"
      class="dynamic-layer"
    />
  </div>
</template>

<style scoped>
.glass-bg {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.glass-layer {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(40px) saturate(1.5);
  -webkit-backdrop-filter: blur(40px) saturate(1.5);
}
.mica-layer {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(80px) saturate(2);
  -webkit-backdrop-filter: blur(80px) saturate(2);
}
.dynamic-layer {
  width: 100%;
  height: 100%;
  /* 慢速旋转：60 秒一圈（参照 WinIsland） */
  animation: dynamic-rotate 60s linear infinite;
}
@keyframes dynamic-rotate {
  from {
    transform: rotate(0deg) scale(1.3);
  }
  to {
    transform: rotate(360deg) scale(1.3);
  }
}
</style>
