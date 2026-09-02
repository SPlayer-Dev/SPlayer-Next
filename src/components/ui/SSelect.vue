<script setup lang="ts">
import type { StyleValue } from "vue";

export interface SSelectOption {
  value: string | number | boolean;
  label: string;
  /** 单条选项的内联样式 */
  style?: StyleValue;
}

export interface SSelectProps {
  modelValue?: string | number | boolean;
  options?: SSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  /** 全圆角胶囊形 */
  round?: boolean;
  /** 使用全屏播放器配色 */
  cover?: boolean;
}

const props = withDefaults(defineProps<SSelectProps>(), {
  options: () => [],
  disabled: false,
  placeholder: "",
  round: false,
  cover: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number | boolean];
}>();

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder,
);

const handleChange = (val: string) => {
  const opt = props.options.find((o) => String(o.value) === val);
  emit("update:modelValue", opt?.value ?? val);
};
</script>

<template>
  <SelectRoot
    :model-value="String(modelValue)"
    :disabled="disabled"
    @update:model-value="handleChange"
  >
    <SelectTrigger
      class="group flex w-full items-center justify-between gap-2 h-8.5 px-3 text-sm border border-solid cursor-pointer outline-none focus-visible:outline-none transition-[border-color,background-color,box-shadow,opacity] duration-250 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
      :class="[
        round ? 'rounded-full' : 'rounded-lg',
        cover
          ? 'text-cover bg-cover/8 border-cover/15 hover:bg-cover/12 hover:border-cover/25 data-[state=open]:border-cover/35 data-[state=open]:ring-2 data-[state=open]:ring-cover/10'
          : 'text-on-surface bg-field border-on-surface/20 hover:border-on-surface/50 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/25',
      ]"
    >
      <SelectValue class="min-w-0 truncate">
        <span class="truncate">{{ selectedLabel }}</span>
      </SelectValue>
      <SelectIcon as-child>
        <IconLucideChevronDown
          class="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
          :class="cover ? 'text-cover/50' : 'text-on-surface-variant/50'"
        />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        :collision-padding="12"
        class="z-400 max-h-60 w-[var(--reka-select-trigger-width)] overflow-hidden rounded-xl bg-surface-bright shadow-lg data-[state=open]:animate-select-in data-[state=closed]:animate-select-out"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :title="opt.label"
            :style="opt.style"
            class="relative flex items-center h-8.5 px-3 pr-8 text-sm rounded-md cursor-pointer outline-none focus-visible:outline-none transition-[background-color,color] duration-200 data-[highlighted]:bg-on-surface/8"
            :class="opt.value === modelValue ? 'text-primary' : 'text-on-surface'"
          >
            <SelectItemText class="truncate">{{ opt.label }}</SelectItemText>
            <SelectItemIndicator class="absolute right-2">
              <IconLucideCheck class="size-3.5 text-primary" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
