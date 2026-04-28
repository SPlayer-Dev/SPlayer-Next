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
  /** 始终显示拖拽点 */
  alwaysShowThumb?: boolean;
  /** 是否在拖拽点 hover/拖拽时显示 pop 弹窗 */
  showPopover?: boolean;
  /** pop 弹窗位置 */
  popoverSide?: "top" | "bottom" | "left" | "right";
  /** pop 弹窗偏移（px） */
  popoverOffset?: number;
  /** 轨道粗细（px） */
  trackHeight?: number;
  /** 拖拽点大小（px） */
  thumbSize?: number;
  /** 刻度标记：{ 值: 标签 } */
  marks?: Record<number, string>;
  /** 垂直方向 */
  vertical?: boolean;
  /** 中心填充 */
  centerFill?: boolean;
  /** 封面主题模式 */
  cover?: boolean;
}

const props = withDefaults(defineProps<SSliderProps>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  alwaysShowThumb: true,
  showPopover: true,
  popoverSide: "top",
  popoverOffset: 8,
  trackHeight: 4,
  thumbSize: 14,
  marks: undefined,
  vertical: false,
  centerFill: false,
  cover: false,
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

/** 进度比例（0~1，便于派生多种几何） */
const progressRatio = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, (displayValue.value - props.min) / range));
});

/** 进度百分比字符串 */
const progressPercent = computed(() => `${Math.round(progressRatio.value * 10000) / 100}%`);

/** 中心填充模式下的填充几何（百分比） */
const centerFillStyle = computed(() => {
  const center = 0.5;
  const ratio = progressRatio.value;
  if (ratio >= center) {
    const len = (ratio - center) * 100;
    return { start: "50%", length: `${len}%` };
  }
  const len = (center - ratio) * 100;
  return { start: `${50 - len}%`, length: `${len}%` };
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
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  const ratio = props.vertical
    ? Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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
    :class="[
      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      vertical ? 'flex flex-col items-center h-full' : '',
    ]"
    :style="{
      '--s-slider-progress': progressPercent,
      '--s-slider-thumb-half': `${thumbSize / 2}px`,
      ...(cover
        ? {
            '--s-slider-track-bg': 'rgb(var(--s-cover) / 0.25)',
            '--s-slider-fill-bg': 'rgb(var(--s-cover))',
            '--s-slider-thumb-bg': 'rgb(var(--s-cover))',
          }
        : {}),
    }"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <!-- 触摸/拖拽区域：水平 -->
    <div
      v-if="!vertical"
      ref="trackRef"
      class="s-slider-hitbox relative flex items-center"
      :style="{ height: `${Math.max(thumbSize, 20)}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        class="s-slider-track absolute left-0 right-0 rounded-full"
        :style="{
          height: `${trackHeight}px`,
          background: 'var(--s-slider-track-bg, rgb(var(--s-on-surface) / 0.12))',
        }"
      />
      <!-- 中心刻度线（仅 centerFill 模式） -->
      <div
        v-if="centerFill"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        :style="{
          width: '2px',
          height: `${trackHeight + 6}px`,
          background: 'rgb(var(--s-on-surface) / 0.2)',
        }"
      />
      <!-- 填充：从左侧 / 中点 -->
      <div
        class="s-slider-fill absolute rounded-full"
        :style="
          centerFill
            ? {
                height: `${trackHeight}px`,
                left: centerFillStyle.start,
                width: centerFillStyle.length,
                background: 'var(--s-slider-fill-bg, rgb(var(--s-primary)))',
              }
            : {
                height: `${trackHeight}px`,
                left: '0',
                width: 'var(--s-slider-progress)',
                background: 'var(--s-slider-fill-bg, rgb(var(--s-primary)))',
              }
        "
      />
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

    <!-- 触摸/拖拽区域：垂直 -->
    <div
      v-else
      ref="trackRef"
      class="s-slider-hitbox relative flex justify-center h-full touch-none"
      :style="{ width: `${Math.max(thumbSize, 20)}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        class="s-slider-track absolute top-0 bottom-0 rounded-full"
        :style="{
          width: `${trackHeight}px`,
          background: 'var(--s-slider-track-bg, rgb(var(--s-on-surface) / 0.12))',
        }"
      />
      <!-- 中心刻度线（仅 centerFill 模式） -->
      <div
        v-if="centerFill"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        :style="{
          height: '2px',
          width: `${trackHeight + 6}px`,
          background: 'rgb(var(--s-on-surface) / 0.2)',
        }"
      />
      <!-- 填充：从底部 / 中点向上 -->
      <div
        class="s-slider-fill absolute rounded-full"
        :style="
          centerFill
            ? {
                width: `${trackHeight}px`,
                bottom: centerFillStyle.start,
                height: centerFillStyle.length,
                background: 'var(--s-slider-fill-bg, rgb(var(--s-primary)))',
              }
            : {
                width: `${trackHeight}px`,
                bottom: '0',
                height: 'var(--s-slider-progress)',
                background: 'var(--s-slider-fill-bg, rgb(var(--s-primary)))',
              }
        "
      />
      <div
        class="s-slider-thumb absolute rounded-full shadow-sm transition-[transform,opacity] duration-150"
        :class="thumbVisible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'"
        :style="{
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          bottom:
            'clamp(calc(var(--s-slider-thumb-half) - 2px), var(--s-slider-progress), calc(100% - var(--s-slider-thumb-half) + 2px))',
          translate: '0 50%',
          background: 'var(--s-slider-thumb-bg, rgb(var(--s-primary)))',
        }"
        @mouseenter="isThumbHovering = true"
        @mouseleave="isThumbHovering = false"
      />
    </div>

    <!-- 刻度标记（仅水平） -->
    <div v-if="marks && !vertical" class="relative w-full mt-1.5" :style="{ height: '18px' }">
      <span
        v-for="(label, key) in marks"
        :key="key"
        class="absolute text-xs text-on-surface-variant/50 leading-none select-none whitespace-nowrap cursor-pointer hover:text-on-surface-variant/80 transition-colors"
        :style="{
          left: `${toPercent(Number(key))}%`,
          translate:
            toPercent(Number(key)) <= 0
              ? '0 0'
              : toPercent(Number(key)) >= 100
                ? '-100% 0'
                : '-50% 0',
        }"
        @click="onMarkClick(Number(key))"
      >
        {{ label }}
      </span>
    </div>

    <!-- Popover -->
    <div
      v-if="showPopover && slots.popover && !vertical"
      class="s-slider-popover absolute pointer-events-none transition-opacity duration-200 ease-out z-20"
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
        class="s-slider-popover-content rounded-lg px-2 py-1 text-xs font-medium shadow-lg whitespace-nowrap border border-solid"
        :style="{
          background: 'var(--s-slider-pop-bg, rgb(var(--s-surface-bright)))',
          color: 'var(--s-slider-pop-text, rgb(var(--s-on-surface)))',
          borderColor: 'var(--s-slider-pop-border, rgb(var(--s-outline-variant) / 0.3))',
        }"
      >
        <slot name="popover" :value="displayValue" />
      </div>
    </div>

    <!-- Popover：垂直模式 -->
    <div
      v-if="showPopover && slots.popover && vertical"
      class="s-slider-popover absolute pointer-events-none transition-opacity duration-200 ease-out z-20"
      :class="[
        popoverSide === 'left' ? 'right-full' : 'left-full',
        popoverVisible ? 'opacity-100' : 'opacity-0',
      ]"
      :style="{
        bottom: 'clamp(12px, var(--s-slider-progress), calc(100% - 12px))',
        translate: '0 50%',
        [popoverSide === 'left' ? 'marginRight' : 'marginLeft']: `${popoverOffset}px`,
      }"
    >
      <div
        class="s-slider-popover-content rounded-lg px-2 py-1 text-xs font-medium shadow-lg whitespace-nowrap border border-solid"
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
