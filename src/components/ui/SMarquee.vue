<script setup lang="ts">
export interface SMarqueeProps {
  /** 滚动速度（px/s） */
  speed?: number;
  /** 开始滚动前的延迟（ms） */
  delay?: number;
  /** 两段文本之间的间距（px） */
  gap?: number;
}

const props = withDefaults(defineProps<SMarqueeProps>(), {
  speed: 30,
  delay: 2000,
  gap: 50,
});

const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const isOverflowing = ref(false);
const animDuration = ref("0s");

let resizeObserver: ResizeObserver | null = null;

const check = () => {
  const container = containerRef.value;
  const text = textRef.value;
  if (!container || !text) return;
  const overflow = text.scrollWidth > container.clientWidth;
  isOverflowing.value = overflow;
  if (overflow) {
    animDuration.value = `${text.scrollWidth / props.speed}s`;
  }
};

onMounted(() => {
  resizeObserver = new ResizeObserver(check);
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  if (textRef.value) resizeObserver.observe(textRef.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="containerRef" class="s-marquee">
    <div
      class="s-marquee-track"
      :class="isOverflowing && 's-marquee-scrolling'"
      :style="{
        '--marquee-duration': animDuration,
        '--marquee-delay': `${delay}ms`,
        '--marquee-gap': `${gap}px`,
      }"
    >
      <span ref="textRef" class="s-marquee-text"><slot /></span>
      <span v-if="isOverflowing" class="s-marquee-text s-marquee-clone" aria-hidden="true"><slot /></span>
    </div>
  </div>
</template>

<style>
.s-marquee {
  overflow: hidden;
  width: 100%;
}
.s-marquee-track {
  display: inline-flex;
  white-space: nowrap;
  min-width: 100%;
  will-change: transform;
}
.s-marquee-text {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}
.s-marquee-clone {
  padding-left: var(--marquee-gap, 50px);
}
.s-marquee-scrolling {
  animation: s-marquee-scroll var(--marquee-duration, 10s) linear var(--marquee-delay, 2s) infinite;
}
@keyframes s-marquee-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(calc(-50% - var(--marquee-gap, 50px) / 2)); }
}
</style>
