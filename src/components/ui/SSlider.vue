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
  /** 刻度标记：{ 值: 标签 }，在滑块下方显示 */
  marks?: Record<number, string>;
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
  marks: undefined,
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

/** 轨道 DOM 引用 */
const trackRef = ref<HTMLElement>();
/** 是否正在拖拽 */
const isDragging = ref(false);
/** 鼠标是否悬停在整个滑块上 */
const isHovering = ref(false);
/** 鼠标是否悬停在拖拽点上 */
const isThumbHovering = ref(false);
/** 拖拽过程中的临时值（松手前不同步给父组件） */
const dragValue = ref(props.modelValue);

/** 外部 modelValue 变化时同步到内部（拖拽中忽略，避免冲突） */
watch(
  () => props.modelValue,
  (val) => {
    if (!isDragging.value) dragValue.value = val;
  },
);

/** 当前显示值 */
const displayValue = computed(() => (isDragging.value ? dragValue.value : props.modelValue));

/** 进度百分比字符串 */
const progressPercent = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return "0%";
  const ratio = Math.max(0, Math.min(1, (displayValue.value - props.min) / range));
  return `${Math.round(ratio * 10000) / 100}%`;
});

/** 拖拽点是否可见（始终显示 / hover / 拖拽中） */
const thumbVisible = computed(() => props.alwaysShowThumb || isHovering.value || isDragging.value);

/** 将值转换为轨道上的百分比位置 */
const toPercent = (value: number): number => ((value - props.min) / (props.max - props.min)) * 100;

/** 点击刻度标记，将值设置到对应位置 */
const onMarkClick = (value: number): void => {
  if (props.disabled) return;
  dragValue.value = value;
  emit("change", value);
  emit("update:modelValue", value);
};

/** popover 是否可见（拖拽点 hover 或拖拽中） */
const popoverVisible = computed(
  () => props.showPopover && (isThumbHovering.value || isDragging.value),
);

/** step 的小数位数 */
const stepDecimals = computed(() => {
  const str = String(props.step);
  const dot = str.indexOf(".");
  return dot < 0 ? 0 : str.length - dot - 1;
});

/** 根据鼠标/触摸位置计算对应的 step 对齐值 */
const calcValueFromEvent = (e: MouseEvent | TouchEvent): number => {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect) return props.min;
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const rawValue = props.min + ratio * (props.max - props.min);
  const stepped = Math.round((rawValue - props.min) / props.step) * props.step + props.min;
  return Math.max(props.min, Math.min(props.max, parseFloat(stepped.toFixed(stepDecimals.value))));
};

/** 按下：开始拖拽，捕获指针 */
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

/** 移动：更新拖拽值 */
const onPointerMove = (e: PointerEvent): void => {
  if (!isDragging.value) return;
  const value = calcValueFromEvent(e);
  dragValue.value = value;
  emit("change", value);
};

/** 松手：结束拖拽，同步最终值给父组件 */
const onPointerUp = (): void => {
  if (!isDragging.value) return;
  isDragging.value = false;
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
          left: 'clamp(calc(var(--s-slider-thumb-half) - 2px), var(--s-slider-progress), calc(100% - var(--s-slider-thumb-half) + 2px))',
          translate: '-50% 0',
          background: 'var(--s-slider-thumb-bg, rgb(var(--s-primary)))',
        }"
        @mouseenter="isThumbHovering = true"
        @mouseleave="isThumbHovering = false"
      />
    </div>

    <!-- 刻度标记 -->
    <div v-if="marks" class="relative w-full mt-1.5" :style="{ height: '18px' }">
      <span
        v-for="(label, key) in marks"
        :key="key"
        class="absolute text-xs text-on-surface-variant/50 leading-none select-none whitespace-nowrap cursor-pointer hover:text-on-surface-variant/80 transition-colors"
        :style="{
          left: `${toPercent(Number(key))}%`,
          translate: toPercent(Number(key)) <= 0 ? '0 0' : toPercent(Number(key)) >= 100 ? '-100% 0' : '-50% 0',
        }"
        @click="onMarkClick(Number(key))"
      >
        {{ label }}
      </span>
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
