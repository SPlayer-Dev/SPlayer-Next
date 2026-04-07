<script setup lang="ts">
export interface SSelectOption {
  value: string | number | boolean;
  label: string;
}

export interface SSelectProps {
  modelValue?: string | number | boolean;
  options?: SSelectOption[];
  disabled?: boolean;
  placeholder?: string;
}

const props = withDefaults(defineProps<SSelectProps>(), {
  options: () => [],
  disabled: false,
  placeholder: "",
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
      class="flex w-full items-center justify-between gap-2 h-8.5 px-3 text-sm text-on-surface bg-surface-bright/40 border border-solid border-outline-variant/50 rounded-lg cursor-pointer outline-none focus-visible:outline-none transition-[border-color,box-shadow] duration-250 hover:border-on-surface/30 data-[state=open]:border-primary data-[state=open]:shadow-[0_0_0_2px_rgb(var(--s-primary)/0.25)] disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
    >
      <SelectValue class="min-w-0 truncate">
        <span class="truncate">{{ selectedLabel }}</span>
      </SelectValue>
      <SelectIcon as-child>
        <IconLucideChevronDown class="size-3.5 text-on-surface-variant/50 shrink-0" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-400 max-h-60 w-[var(--reka-select-trigger-width)] overflow-hidden rounded-xl bg-surface-bright border border-solid border-outline-variant/30 shadow-lg data-[state=open]:animate-select-in data-[state=closed]:animate-select-out"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :title="opt.label"
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
