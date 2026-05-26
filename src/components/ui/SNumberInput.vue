<script setup lang="ts">
export interface SNumberInputProps {
  modelValue?: number | null;
  placeholder?: string;
  disabled?: boolean;
  round?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** 单位后缀 */
  unit?: string;
  size?: "small" | "medium" | "large";
  status?: "default" | "error";
  /** 封面主题模式 */
  cover?: boolean;
}

const props = withDefaults(defineProps<SNumberInputProps>(), {
  modelValue: null,
  placeholder: "",
  disabled: false,
  round: false,
  size: "medium",
  status: "default",
  cover: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: number];
  focus: [];
  blur: [];
}>();

const sizeClasses = computed(() => {
  if (props.size === "small") return "h-7 text-xs";
  if (props.size === "large") return "h-10 text-base";
  return "h-8.5 text-sm";
});

/** 步进按钮尺寸（与高度相同，呈正方形） */
const stepperClass = computed(() => {
  if (props.size === "small") return "w-7";
  if (props.size === "large") return "w-10";
  return "w-8.5";
});

/** NumberField modelValue 是 number；null/undefined 走 undefined 让组件内部判断 */
const innerValue = computed<number | undefined>(() =>
  props.modelValue == null ? undefined : props.modelValue,
);

const onUpdate = (value: number): void => {
  emit("update:modelValue", value);
};

const isFocused = ref(false);
</script>

<template>
  <NumberFieldRoot
    :model-value="innerValue"
    :min="min"
    :max="max"
    :step="step ?? 1"
    :disabled="disabled"
    :format-options="{ useGrouping: false }"
    class="inline-flex items-center border border-solid overflow-hidden transition-[border-color,box-shadow,background-color,width,opacity] duration-250"
    :class="[
      sizeClasses,
      cover ? 'text-cover' : 'text-on-surface',
      round ? 'rounded-full' : 'rounded-lg',
      status === 'error'
        ? isFocused
          ? 'bg-on-surface/8 border-red-500 ring-2 ring-red-500/20'
          : 'bg-on-surface/3 border-red-500/60 hover:bg-on-surface/10'
        : cover
          ? isFocused
            ? 'bg-cover/15 border-cover/60 ring-2 ring-cover/20'
            : 'bg-cover/8 border-cover/30 hover:bg-cover/15 hover:border-cover/45'
          : isFocused
            ? 'bg-on-surface/8 border-primary ring-2 ring-primary/20'
            : 'bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]"
    @update:model-value="onUpdate"
  >
    <NumberFieldDecrement
      :class="[
        stepperClass,
        'h-full inline-flex items-center justify-center shrink-0 bg-transparent border-none outline-none cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        cover
          ? 'text-cover/70 hover:text-cover hover:bg-cover/10 disabled:hover:text-cover/70'
          : 'text-on-surface-variant/70 hover:text-on-surface hover:bg-on-surface/8 disabled:hover:text-on-surface-variant/70',
      ]"
    >
      <IconLucideMinus class="size-3.5" />
    </NumberFieldDecrement>
    <slot name="prefix" />
    <!-- 中：输入 -->
    <NumberFieldInput
      :placeholder="placeholder"
      class="flex-1 min-w-0 h-full px-1 bg-transparent outline-none border-none shadow-none text-center disabled:cursor-not-allowed"
      :class="
        cover
          ? 'text-cover placeholder:text-cover/40 !selection:bg-cover/35 !selection:text-cover'
          : 'text-on-surface placeholder:text-on-surface-variant/40'
      "
      @focus="
        isFocused = true;
        emit('focus');
      "
      @blur="
        isFocused = false;
        emit('blur');
      "
    />

    <slot name="suffix" />
    <span
      v-if="unit"
      class="text-xs mr-1"
      :class="cover ? 'text-cover/60' : 'text-on-surface-variant/60'"
      >{{ unit }}</span
    >
    <NumberFieldIncrement
      :class="[
        stepperClass,
        'h-full inline-flex items-center justify-center shrink-0 bg-transparent border-none outline-none cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        cover
          ? 'text-cover/70 hover:text-cover hover:bg-cover/10 disabled:hover:text-cover/70'
          : 'text-on-surface-variant/70 hover:text-on-surface hover:bg-on-surface/8 disabled:hover:text-on-surface-variant/70',
      ]"
    >
      <IconLucidePlus class="size-3.5" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>
