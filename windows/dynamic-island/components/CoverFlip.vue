<script setup lang="ts">
/**
 * 封面翻转动画组件
 * 参照 WinIsland 的 trigger_cover_flip：0.6 秒 3D 翻转（X 轴缩放 cos 曲线）
 */
interface Props {
  /** 封面 URL */
  src: string;
  /** 封面尺寸（px） */
  size?: number;
  /** 圆角（px） */
  radius?: number;
  /** 默认封面 URL */
  defaultSrc?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 72,
  radius: 12,
  defaultSrc: "",
});

const currentSrc = ref(props.src);
const flipProgress = ref(0);
const isFlipping = ref(false);
let flipRafId: number | null = null;

/** 触发翻转动画 */
const triggerFlip = (newSrc: string): void => {
  if (isFlipping.value || newSrc === currentSrc.value) return;
  isFlipping.value = true;
  flipProgress.value = 0;

  const duration = 600;
  const startTime = performance.now();

  const animate = (now: number): void => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    // cos 曲线：1 → 0 → 1
    flipProgress.value = (1 - Math.cos(t * Math.PI)) / 2;

    // 翻转到一半时切换图片
    if (t >= 0.5 && currentSrc.value !== newSrc) {
      currentSrc.value = newSrc;
    }

    if (t < 1) {
      flipRafId = requestAnimationFrame(animate);
    } else {
      isFlipping.value = false;
      flipProgress.value = 0;
      currentSrc.value = newSrc;
    }
  };

  flipRafId = requestAnimationFrame(animate);
};

/** X 轴缩放值 */
const scaleX = computed(() => {
  if (!isFlipping.value) return 1;
  return Math.abs(Math.cos(flipProgress.value * Math.PI));
});

watch(() => props.src, (newSrc) => {
  if (newSrc && newSrc !== currentSrc.value) {
    triggerFlip(newSrc);
  }
});

onBeforeUnmount(() => {
  if (flipRafId !== null) cancelAnimationFrame(flipRafId);
});
</script>

<template>
  <div
    class="cover-flip"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${radius}px`,
      transform: `scaleX(${scaleX})`,
    }"
  >
    <img
      :src="currentSrc || defaultSrc"
      alt="cover"
      class="cover-img"
      draggable="false"
      decoding="async"
      @error="($event.target as HTMLImageElement).src = defaultSrc"
    />
  </div>
</template>

<style scoped>
.cover-flip {
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transition: filter 0.1s ease;
  will-change: transform;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}
</style>
