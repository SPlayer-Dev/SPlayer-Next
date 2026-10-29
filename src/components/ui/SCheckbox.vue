<script setup lang="ts">
import { checkboxGroupContextKey, type GroupSize, type SCheckboxGroupValue } from "./group-context";

type SCheckSize = GroupSize;

export interface SCheckboxProps {
  /** 勾选状态（语义优先） */
  checked?: boolean;
  /** 兼容默认 v-model（不推荐） */
  modelValue?: boolean;
  /** 分组模式下的值 */
  value?: SCheckboxGroupValue;
  /** 半选状态 */
  indeterminate?: boolean;
  /** 禁用状态 */
  disabled?: boolean;
  /** 尺寸 */
  size?: SCheckSize;
  /** 文本标签 */
  label?: string;
}

const props = withDefaults(defineProps<SCheckboxProps>(), {
  checked: undefined,
  modelValue: false,
  value: undefined,
  indeterminate: false,
  disabled: false,
  size: undefined,
  label: "",
});

const emit = defineEmits<{
  "update:checked": [value: boolean];
  "update:modelValue": [value: boolean];
}>();

const checkboxGroup = inject(checkboxGroupContextKey, null);

const sizeClassMap: Record<SCheckSize, string> = {
  small: "size-4",
  medium: "size-4.5",
  large: "size-5",
};

const iconSizeClassMap: Record<SCheckSize, string> = {
  small: "size-3",
  medium: "size-3.5",
  large: "size-4",
};

const mergedSize = computed<SCheckSize>(() => props.size ?? checkboxGroup?.size.value ?? "medium");

const checked = computed(() => {
  if (checkboxGroup) {
    if (props.value === undefined) return false;
    return checkboxGroup.value.value.includes(props.value);
  }
  if (typeof props.checked === "boolean") return props.checked;
  return props.modelValue;
});

const mergedDisabled = computed(() => props.disabled || checkboxGroup?.disabled.value === true);
const canToggle = computed(() => !mergedDisabled.value);

const hasLabel = computed(() => !!props.label || !!useSlots().default);

const handleToggle = (): void => {
  if (!canToggle.value) return;
  const next = !checked.value;
  if (checkboxGroup) {
    if (props.value === undefined) return;
    checkboxGroup.toggle(props.value, next);
  } else {
    emit("update:checked", next);
    emit("update:modelValue", next);
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  handleToggle();
};
</script>

<template>
  <label
    class="inline-flex items-center gap-2 select-none"
    :class="mergedDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'"
    @click.prevent="handleToggle"
  >
    <span
      role="checkbox"
      :tabindex="mergedDisabled ? -1 : 0"
      :aria-checked="indeterminate ? 'mixed' : checked ? 'true' : 'false'"
      class="shrink-0 inline-flex items-center justify-center border border-solid outline-none transition-[background-color,border-color,color,box-shadow] duration-200"
      :class="[
        sizeClassMap[mergedSize],
        'rounded-[5px]',
        checked || indeterminate
          ? 'bg-primary border-primary text-on-primary'
          : 'bg-transparent border-on-surface/35 text-transparent hover:border-on-surface/55',
      ]"
      @keydown="onKeydown"
    >
      <IconLucideMinus
        v-if="indeterminate"
        :class="[iconSizeClassMap[mergedSize], 'pointer-events-none']"
      />
      <IconLucideCheck
        v-else-if="checked"
        :class="[iconSizeClassMap[mergedSize], 'pointer-events-none']"
      />
    </span>
    <span v-if="hasLabel" class="min-w-0 flex-1 text-sm text-on-surface">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>
