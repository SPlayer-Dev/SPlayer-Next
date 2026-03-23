<script setup lang="ts">
export interface SPopoverProps {
  /** 弹出位置 */
  side?: "top" | "right" | "bottom" | "left";
  /** 对齐方式 */
  align?: "start" | "center" | "end";
  /** 与触发元素的距离（px） */
  sideOffset?: number;
  /** 触发方式 */
  trigger?: "click" | "hover" | "focus" | "manual";
  /** 手动控制 open（trigger="manual" 时使用） */
  open?: boolean;
  /** hover 触发时的延迟（ms） */
  openDelay?: number;
  /** hover 离开时的关闭延迟（ms） */
  closeDelay?: number;
  /** 是否显示箭头 */
  arrow?: boolean;
}

const props = withDefaults(defineProps<SPopoverProps>(), {
  side: "bottom",
  align: "center",
  sideOffset: 6,
  trigger: "click",
  openDelay: 200,
  closeDelay: 150,
  arrow: false,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const isOpen = ref(props.open ?? false);

// 同步外部 open prop
watch(
  () => props.open,
  (val) => {
    if (val !== undefined) isOpen.value = val;
  },
);

const setOpen = (val: boolean): void => {
  isOpen.value = val;
  emit("update:open", val);
};

// hover 触发的延时器
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimers = (): void => {
  if (openTimer) { clearTimeout(openTimer); openTimer = null; }
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
};

const handlePointerEnter = (): void => {
  if (props.trigger !== "hover") return;
  clearTimers();
  openTimer = setTimeout(() => setOpen(true), props.openDelay);
};

const handlePointerLeave = (): void => {
  if (props.trigger !== "hover") return;
  clearTimers();
  closeTimer = setTimeout(() => setOpen(false), props.closeDelay);
};

const handleFocus = (): void => {
  if (props.trigger !== "focus") return;
  setOpen(true);
};

const handleBlur = (): void => {
  if (props.trigger !== "focus") return;
  setOpen(false);
};

onUnmounted(clearTimers);
</script>

<template>
  <PopoverRoot
    :open="isOpen"
    @update:open="trigger === 'click' ? setOpen($event) : undefined"
  >
    <PopoverTrigger as-child>
      <span
        class="inline-flex"
        @pointerenter="handlePointerEnter"
        @pointerleave="handlePointerLeave"
        @focusin="handleFocus"
        @focusout="handleBlur"
      >
        <slot name="trigger" />
      </span>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :avoid-collisions="true"
        class="z-100 rounded-xl bg-surface-bright border border-outline-variant/30 shadow-lg p-3 text-sm text-on-surface data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out"
        @pointerenter="handlePointerEnter"
        @pointerleave="handlePointerLeave"
        @escape-key-down="setOpen(false)"
      >
        <slot />
        <PopoverArrow v-if="arrow" class="fill-surface-bright" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
