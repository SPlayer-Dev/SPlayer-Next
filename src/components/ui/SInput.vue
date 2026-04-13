<script setup lang="ts">
export interface SInputProps {
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  round?: boolean;
  type?: string;
  /** 尺寸 */
  size?: "small" | "medium" | "large";
}

const props = withDefaults(defineProps<SInputProps>(), {
  modelValue: "",
  placeholder: "",
  disabled: false,
  clearable: false,
  round: false,
  type: "text",
  size: "medium",
});

const sizeClasses = computed(() => {
  if (props.size === "small") return "h-7 px-2 text-xs";
  if (props.size === "large") return "h-10 px-4 text-base";
  return "h-8.5 px-3 text-sm";
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  focus: [];
  blur: [];
}>();

const isFocused = ref(false);
const showClear = computed(() => props.clearable && props.modelValue.length > 0 && !props.disabled);

const handleClear = () => {
  emit("update:modelValue", "");
};
</script>

<template>
  <div
    class="flex items-center gap-2 text-on-surface border border-solid transition-[border-color,box-shadow,background-color,width,opacity] duration-250"
    :class="[
      sizeClasses,
      round ? 'rounded-full' : 'rounded-lg',
      isFocused
        ? 'bg-on-surface/12 border-primary ring-2 ring-primary/25'
        : 'bg-on-surface/5 border-primary/15 hover:bg-on-surface/8',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]"
  >
    <!-- 前置插槽 -->
    <slot name="prefix" />

    <input
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      class="flex-1 min-w-0 h-full bg-transparent outline-none border-none shadow-none text-on-surface placeholder:text-on-surface-variant/40 disabled:cursor-not-allowed"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="
        isFocused = true;
        emit('focus');
      "
      @blur="
        isFocused = false;
        emit('blur');
      "
    />

    <!-- 清空按钮 -->
    <Transition name="fade">
      <IconLucideX
        v-if="showClear"
        class="size-3.5 text-on-surface-variant/50 shrink-0 cursor-pointer transition-colors duration-200 hover:text-on-surface"
        @click="handleClear"
      />
    </Transition>

    <!-- 后置插槽 -->
    <slot name="suffix" />
  </div>
</template>
