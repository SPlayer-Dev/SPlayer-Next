<script setup lang="ts">
export interface SNumberInputProps {
  modelValue?: number | null;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  round?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** 单位后缀 */
  unit?: string;
  size?: "small" | "medium" | "large";
  status?: "default" | "error";
}

const props = withDefaults(defineProps<SNumberInputProps>(), {
  modelValue: null,
  placeholder: "",
  disabled: false,
  readonly: false,
  round: false,
  size: "medium",
  status: "default",
});

const emit = defineEmits<{
  "update:modelValue": [value: number];
  focus: [];
  blur: [];
}>();

const sizeClasses = computed(() => {
  if (props.size === "small") return "h-7 px-2 text-xs";
  if (props.size === "large") return "h-10 px-4 text-base";
  return "h-8.5 px-3 text-sm";
});

/**
 * 编辑中的本地字符串
 */
const draft = ref<string>(props.modelValue == null ? "" : String(props.modelValue));

watch(
  () => props.modelValue,
  (v) => {
    const next = v == null ? "" : String(v);
    if (next !== draft.value) draft.value = next;
  },
);

const clamp = (n: number): number => {
  const min = props.min ?? -Infinity;
  const max = props.max ?? Infinity;
  return Math.max(min, Math.min(max, n));
};

const isFocused = ref(false);

/** 输入即写回 */
const onInput = (event: Event): void => {
  const raw = (event.target as HTMLInputElement).value;
  draft.value = raw;
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  emit("update:modelValue", clamp(n));
};

/** 失焦回退：draft 不是合法数字 → 恢复成 props.modelValue */
const onBlur = (): void => {
  const n = Number(draft.value);
  if (draft.value === "" || !Number.isFinite(n)) {
    draft.value = props.modelValue == null ? "" : String(props.modelValue);
  }
  isFocused.value = false;
  emit("blur");
};
</script>

<template>
  <div
    class="flex items-center gap-2 text-on-surface border border-solid transition-[border-color,box-shadow,background-color,width,opacity] duration-250"
    :class="[
      sizeClasses,
      round ? 'rounded-full' : 'rounded-lg',
      isFocused
        ? status === 'error'
          ? 'bg-on-surface/8 border-red-500 ring-2 ring-red-500/20'
          : 'bg-on-surface/8 border-primary ring-2 ring-primary/20'
        : status === 'error'
          ? 'bg-on-surface/3 border-red-500/60 hover:bg-on-surface/10'
          : 'bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]"
  >
    <slot name="prefix" />

    <input
      :value="draft"
      type="number"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :min="min"
      :max="max"
      :step="step"
      class="flex-1 min-w-0 h-full bg-transparent outline-none border-none shadow-none text-on-surface placeholder:text-on-surface-variant/40 disabled:cursor-not-allowed"
      :class="readonly ? 'cursor-pointer' : ''"
      @input="onInput"
      @focus="
        isFocused = true;
        emit('focus');
      "
      @blur="onBlur"
    />

    <slot name="suffix" />
    <span v-if="unit" class="text-xs text-on-surface-variant/60 pr-1">{{ unit }}</span>
  </div>
</template>
