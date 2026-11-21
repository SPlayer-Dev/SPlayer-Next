<script setup lang="ts">
/**
 * 苹果风格进度/音量条
 *
 * 行为移植自 @applemusic-like-lyrics/react-full 的 BouncingSlider（AGPL-3.0）：
 * 高频进度直接写 DOM 样式而不经过响应式系统，拖拽时整条按 tanh 阻尼横向回弹，
 * 松手后由弹簧归位。
 */

export interface AppleSliderProps {
  /** 当前值 */
  modelValue: number;
  /** 最小值 */
  min?: number;
  /** 最大值 */
  max?: number;
  /** 播放中时由内部 RAF 自行推进，外部只需按推送频率更新 modelValue */
  playing?: boolean;
  /** 是否允许运行高频推进，播放器收起或窗口隐藏时为 false */
  active?: boolean;
  /** 拖拽过程中持续派发 change（音量条），否则仅在松手时派发（进度条） */
  changeOnDrag?: boolean;
  /** 过渡光晕 */
  glow?: boolean;
}

const props = withDefaults(defineProps<AppleSliderProps>(), {
  min: 0,
  max: 100,
  playing: false,
  active: true,
  changeOnDrag: false,
  glow: false,
});

const emit = defineEmits<{
  /** 值变化：拖拽中（changeOnDrag）或松手时派发 */
  change: [value: number];
}>();

/** 回弹最大位移（px），与 AMLL 一致 */
const MAX_BOUNCE = 12;
/** 回弹弹簧参数，与 AMLL 的 framer-motion 配置一致 */
const SPRING_STIFFNESS = 300;
const SPRING_DAMPING = 12;

const rootRef = ref<HTMLElement>();
const trackRef = ref<HTMLElement>();
const fillRef = ref<HTMLElement>();

const hovering = ref(false);
const dragging = ref(false);
const expanded = computed(() => hovering.value || dragging.value);

/** 内部时间/值，拖拽和自走时以它为准 */
let localValue = props.modelValue;
/** 拖拽起点捕获的轨道矩形，避免回弹位移反馈进取值 */
let capturedRect: DOMRect | null = null;

let progressRaf: number | null = null;
let progressLastFrame = 0;

let bounceX = 0;
let bounceVelocity = 0;
let bounceTarget = 0;
let bounceRaf: number | null = null;
let bounceLastFrame = 0;

/** 把值写入填充条，比例直接用 scaleX 表达 */
const applyProgress = (value: number): void => {
  const span = props.max - props.min;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (value - props.min) / span)) : 0;
  if (fillRef.value) fillRef.value.style.transform = `scaleX(${ratio})`;
};

/** 播放推进：每帧加真实时间差，与外部推送在 watch 中保持同步 */
const progressTick = (now: number): void => {
  const delta = Math.min(now - progressLastFrame, 64);
  progressLastFrame = now;
  if (!dragging.value) {
    localValue = Math.min(props.max, localValue + delta);
    applyProgress(localValue);
  }
  progressRaf = requestAnimationFrame(progressTick);
};

const startProgress = (): void => {
  if (progressRaf !== null) return;
  progressLastFrame = performance.now();
  progressRaf = requestAnimationFrame(progressTick);
};

const stopProgress = (): void => {
  if (progressRaf === null) return;
  cancelAnimationFrame(progressRaf);
  progressRaf = null;
};

/** 回弹弹簧积分，松手后自然过冲再归位 */
const bounceTick = (now: number): void => {
  const dt = Math.min((now - bounceLastFrame) / 1000, 1 / 30);
  bounceLastFrame = now;
  const acceleration =
    -SPRING_STIFFNESS * (bounceX - bounceTarget) - SPRING_DAMPING * bounceVelocity;
  bounceVelocity += acceleration * dt;
  bounceX += bounceVelocity * dt;
  if (Math.abs(bounceVelocity) < 1 && Math.abs(bounceX - bounceTarget) < 0.1) {
    bounceX = bounceTarget;
    bounceVelocity = 0;
    bounceRaf = null;
    if (rootRef.value) rootRef.value.style.transform = `translateX(${bounceX}px)`;
    return;
  }
  if (rootRef.value) rootRef.value.style.transform = `translateX(${bounceX}px)`;
  bounceRaf = requestAnimationFrame(bounceTick);
};

const setBounceTarget = (target: number): void => {
  bounceTarget = target;
  if (bounceRaf !== null) return;
  bounceLastFrame = performance.now();
  bounceRaf = requestAnimationFrame(bounceTick);
};

/** 根据指针位置换算当前值 */
const valueFromClientX = (clientX: number): number => {
  const rect = capturedRect ?? trackRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0) return props.min;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return props.min + ratio * (props.max - props.min);
};

const onPointerDown = (e: PointerEvent): void => {
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragging.value = true;
  capturedRect = trackRef.value?.getBoundingClientRect() ?? null;
  localValue = valueFromClientX(e.clientX);
  applyProgress(localValue);
};

const onPointerMove = (e: PointerEvent): void => {
  if (!dragging.value) return;
  if (capturedRect && capturedRect.width > 0) {
    const ratio = (e.clientX - capturedRect.left) / capturedRect.width;
    if (ratio < 0) setBounceTarget(Math.tanh(ratio * 2) * MAX_BOUNCE);
    else if (ratio > 1) setBounceTarget(Math.tanh((ratio - 1) * 2) * MAX_BOUNCE);
    else setBounceTarget(0);
  }
  localValue = valueFromClientX(e.clientX);
  applyProgress(localValue);
  if (props.changeOnDrag) emit("change", localValue);
};

const onPointerUp = (): void => {
  if (!dragging.value) return;
  dragging.value = false;
  capturedRect = null;
  setBounceTarget(0);
  emit("change", localValue);
};

/** 外部推送到来时同步内部值与填充宽度，拖拽中忽略 */
watch(
  [() => props.modelValue, () => props.min, () => props.max],
  ([value]) => {
    if (dragging.value) return;
    localValue = value;
    applyProgress(value);
  },
  { immediate: true },
);

/** 只有真正在播放且允许高频渲染时才自走 */
watch(
  () => props.active && props.playing,
  (run) => (run ? startProgress() : stopProgress()),
  { immediate: true },
);

onMounted(() => applyProgress(localValue));

onBeforeUnmount(() => {
  stopProgress();
  if (bounceRaf !== null) cancelAnimationFrame(bounceRaf);
});
</script>

<template>
  <div
    ref="rootRef"
    class="apple-slider"
    :class="{ 'is-glowing': glow }"
    role="slider"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    @pointerenter="hovering = true"
    @pointerleave="hovering = false"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div ref="trackRef" class="apple-slider-track" :class="{ 'is-expanded': expanded }">
      <div ref="fillRef" class="apple-slider-fill" />
    </div>
  </div>
</template>

<style scoped>
.apple-slider {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 24px;
  cursor: pointer;
  touch-action: none;
  transform: translateZ(0);
}

.apple-slider-track {
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 100px;
  background: rgb(var(--s-cover) / 0.25);
  transition: height 0.45s cubic-bezier(0.22, 1.3, 0.36, 1);
}

.apple-slider-track.is-expanded {
  height: 20px;
  transition: height 0.28s ease-out;
}

.apple-slider-fill {
  width: 100%;
  height: 100%;
  background: rgb(var(--s-cover));
  transform: scaleX(0);
  transform-origin: left center;
}

.apple-slider.is-glowing .apple-slider-track {
  animation: apple-slider-glow 1.4s ease-in-out infinite alternate;
}

@keyframes apple-slider-glow {
  from {
    filter: drop-shadow(0 0 3px rgb(var(--s-cover) / 0.8))
      drop-shadow(0 0 8px rgb(var(--s-cover) / 0.35));
  }

  to {
    filter: drop-shadow(0 0 4px rgb(var(--s-cover) / 0.95))
      drop-shadow(0 0 12px rgb(var(--s-cover) / 0.5));
  }
}

@media (prefers-reduced-motion: reduce) {
  .apple-slider-track {
    transition: none;
  }

  .apple-slider.is-glowing .apple-slider-track {
    animation: none;
  }
}
</style>
