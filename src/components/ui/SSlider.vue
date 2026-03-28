<script setup lang="ts">
export interface SSliderProps {
  /** 当前值 */
  modelValue?: number;
  /** 最小值 */
  min?: number;
  /** 最大值 */
  max?: number;
  /** 步进值 */
  step?: number;
  /** 是否禁用 */
  disabled?: boolean;
  /** 始终显示拖拽点（false 时仅 hover 显示） */
  alwaysShowThumb?: boolean;
  /** 是否在拖拽点 hover/拖拽时显示 pop 弹窗 */
  showPopover?: boolean;
  /** pop 弹窗位置 */
  popoverSide?: "top" | "bottom";
  /** pop 弹窗偏移（px） */
  popoverOffset?: number;
  /** 轨道高度（px） */
  trackHeight?: number;
  /** 拖拽点大小（px） */
  thumbSize?: number;
}

const props = withDefaults(defineProps<SSliderProps>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  alwaysShowThumb: false,
  showPopover: true,
  popoverSide: "top",
  popoverOffset: 8,
  trackHeight: 4,
  thumbSize: 14,
});

const emit = defineEmits<{
  "update:modelValue": [value: number];
  /** 值改变（拖拽中也会触发） */
  change: [value: number];
  /** 拖拽开始 */
  dragStart: [value: number];
  /** 拖拽结束 */
  dragEnd: [value: number];
}>();

const slots = defineSlots<{
  /** 自定义 popover 内容，参数为当前值 */
  popover?(props: { value: number }): unknown;
}>();

const trackRef = ref<HTMLElement>();
const isDragging = ref(false);
const isHovering = ref(false);
const isThumbHovering = ref(false);
const dragValue = ref(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    if (!isDragging.value) dragValue.value = val;
  },
);

const displayValue = computed(() => (isDragging.value ? dragValue.value : props.modelValue));

const progressPercent = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return "0%";
  const ratio = Math.max(0, Math.min(1, (displayValue.value - props.min) / range));
  return `${Math.round(ratio * 10000) / 100}%`;
});

const thumbVisible = computed(() => props.alwaysShowThumb || isHovering.value || isDragging.value);

/** popover 是否可见（只控制 opacity class，DOM 常驻不移除，CSS transition 自然过渡） */
const popoverVisible = computed(
  () => props.showPopover && (isThumbHovering.value || isDragging.value),
);

const calcValueFromEvent = (e: MouseEvent | TouchEvent): number => {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect) return props.min;
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const rawValue = props.min + ratio * (props.max - props.min);
  const stepped = Math.round((rawValue - props.min) / props.step) * props.step + props.min;
  return Math.max(props.min, Math.min(props.max, stepped));
};

const onPointerDown = (e: PointerEvent): void => {
  if (props.disabled) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  isDragging.value = true;
  const value = calcValueFromEvent(e);
  dragValue.value = value;
  emit("change", value);
  emit("dragStart", value);
};

const onPointerMove = (e: PointerEvent): void => {
  if (!isDragging.value) return;
  const value = calcValueFromEvent(e);
  dragValue.value = value;
  emit("change", value);
};

const onPointerUp = (): void => {
  if (!isDragging.value) return;
  isDragging.value = false;
  // 松手时才同步最终值给父组件
  emit("update:modelValue", dragValue.value);
  emit("dragEnd", dragValue.value);
};
</script>

<template>
  <div
    class="s-slider relative select-none"
    :class="[disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer']"
    :style="{
      '--s-slider-progress': progressPercent,
      '--s-slider-thumb-half': `${thumbSize / 2}px`,
    }"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <!-- 触摸/拖拽区域 -->
    <div
      ref="trackRef"
      class="s-slider-hitbox relative flex items-center"
      :style="{ height: `${Math.max(thumbSize, 20)}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- 轨道背景（未播放部分） -->
      <div
        class="s-slider-track absolute left-0 right-0 rounded-full"
        :style="{
          height: `${trackHeight}px`,
          background: 'var(--s-slider-track-bg, rgb(var(--s-on-surface) / 0.12))',
        }"
      />
      <!-- 已填充部分 -->
      <div
        class="s-slider-fill absolute left-0 rounded-full"
        :style="{
          height: `${trackHeight}px`,
          width: 'var(--s-slider-progress)',
          background: 'var(--s-slider-fill-bg, rgb(var(--s-primary)))',
        }"
      />
      <!-- 拖拽点 -->
      <div
        class="s-slider-thumb absolute rounded-full shadow-sm transition-[transform,opacity] duration-150"
        :class="thumbVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'"
        :style="{
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          left: 'clamp(var(--s-slider-thumb-half), var(--s-slider-progress), calc(100% - var(--s-slider-thumb-half)))',
          translate: '-50% 0',
          background: 'var(--s-slider-thumb-bg, rgb(var(--s-primary)))',
        }"
        @mouseenter="isThumbHovering = true"
        @mouseleave="isThumbHovering = false"
      />
    </div>

    <!-- Popover -->
    <div
      v-if="showPopover && slots.popover"
      class="s-slider-popover absolute pointer-events-none transition-opacity duration-200 ease-out"
      :class="[
        popoverSide === 'top' ? 'bottom-full' : 'top-full',
        popoverVisible ? 'opacity-100' : 'opacity-0',
      ]"
      :style="{
        left: 'clamp(24px, var(--s-slider-progress), calc(100% - 24px))',
        translate: '-50% 0',
        [popoverSide === 'top' ? 'marginBottom' : 'marginTop']: `${popoverOffset}px`,
      }"
    >
      <div
        class="s-slider-popover-content rounded-lg px-2 py-1 text-xs font-medium shadow-lg whitespace-nowrap border-1 border-solid"
        :style="{
          background: 'var(--s-slider-pop-bg, rgb(var(--s-surface-bright)))',
          color: 'var(--s-slider-pop-text, rgb(var(--s-on-surface)))',
          borderColor: 'var(--s-slider-pop-border, rgb(var(--s-outline-variant) / 0.3))',
        }"
      >
        <slot name="popover" :value="displayValue" />
      </div>
    </div>
  </div>
</template>
