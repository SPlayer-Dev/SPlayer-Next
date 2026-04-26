<script setup lang="ts">
import type { SSelectOption } from "./SSelect.vue";

export interface SPopselectProps {
  modelValue?: string | number | boolean;
  options?: SSelectOption[];
  disabled?: boolean;
  /** 弹出位置 */
  side?: "top" | "right" | "bottom" | "left";
  /** 对齐方式 */
  align?: "start" | "center" | "end";
  /** 与触发元素的距离（px） */
  sideOffset?: number;
  /** 封面主题模式 */
  cover?: boolean;
  /** 面板最小宽度（px），默认 120 */
  minWidth?: number;
}

const props = withDefaults(defineProps<SPopselectProps>(), {
  options: () => [],
  disabled: false,
  side: "bottom",
  align: "center",
  sideOffset: 6,
  cover: false,
  minWidth: 120,
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number | boolean];
  "update:open": [value: boolean];
}>();

const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue));

const handleChange = (val: string): void => {
  const opt = props.options.find((o) => String(o.value) === val);
  emit("update:modelValue", opt?.value ?? val);
};
</script>

<template>
  <SelectRoot
    :model-value="String(modelValue)"
    :disabled="disabled"
    @update:model-value="handleChange"
    @update:open="emit('update:open', $event)"
  >
    <SelectTrigger as-child :disabled="disabled">
      <slot name="trigger" :selected="selectedOption">
        <span class="inline-flex items-center text-sm text-on-surface-variant cursor-pointer">
          {{ selectedOption?.label ?? "" }}
        </span>
      </slot>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :style="{ minWidth: `${minWidth}px` }"
        :class="[
          'z-400 rounded-lg shadow-lg text-sm data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out',
          cover
            ? 'bg-black/55 backdrop-blur-xl backdrop-saturate-160 border border-solid border-white/10'
            : 'bg-surface-bright border border-solid border-outline-variant/30',
        ]"
      >
        <SelectViewport class="p-1 max-h-60">
          <SelectItem
            v-for="opt in options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :title="opt.label"
            :class="[
              'relative flex items-center h-8 px-2.5 pr-7 rounded-md cursor-pointer outline-none focus-visible:outline-none transition-colors duration-200',
              cover ? 'data-[highlighted]:bg-white/10' : 'data-[highlighted]:bg-on-surface/8',
              opt.value === modelValue
                ? cover
                  ? 'text-cover'
                  : 'text-primary'
                : cover
                  ? 'text-cover/80'
                  : 'text-on-surface',
            ]"
          >
            <SelectItemText class="flex-1 truncate">{{ opt.label }}</SelectItemText>
            <SelectItemIndicator class="absolute right-2">
              <IconLucideCheck class="size-3.5" :class="cover ? 'text-cover' : 'text-primary'" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
