<script setup lang="ts">
import SButton from "./SButton.vue";
import IconLucideX from "~icons/lucide/x";

export interface STagProps {
  /** 颜色类型 */
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
  /** 变体：soft 软底、filled 纯色、outline 描边 */
  variant?: "soft" | "filled" | "outline";
  /** 尺寸 */
  size?: "tiny" | "small" | "medium" | "large";
  /** 胶囊形 */
  round?: boolean;
  /** 是否显示右侧 × 关闭按钮 */
  closable?: boolean;
}

const props = withDefaults(defineProps<STagProps>(), {
  type: "primary",
  variant: "soft",
  size: "medium",
});

defineEmits<{ close: [] }>();

type Size = NonNullable<STagProps["size"]>;

const sizePresets: Record<Size, { base: string; closable: string }> = {
  tiny: { base: "h-4 px-1 text-[10px]", closable: "h-4 pl-1 pr-0.5 gap-0.5 text-[10px]" },
  small: { base: "h-5 px-1.5 text-xs", closable: "h-5 pl-1.5 pr-0.5 gap-1 text-xs" },
  medium: { base: "h-6 px-2 text-sm", closable: "h-6 pl-2 pr-1 gap-1 text-sm" },
  large: { base: "h-7 px-2.5 text-sm", closable: "h-7 pl-2.5 pr-1 gap-1.5 text-sm" },
};

const closeBtnSize: Record<Size, { btn: number; icon: number }> = {
  tiny: { btn: 12, icon: 8 },
  small: { btn: 14, icon: 10 },
  medium: { btn: 16, icon: 11 },
  large: { btn: 20, icon: 13 },
};

const variantStyles = {
  soft: {
    default: "bg-on-surface/12 text-on-surface",
    primary: "bg-primary/15 text-primary",
    cover: "bg-cover/15 text-cover",
    info: "bg-blue-500/15 text-blue-500",
    success: "bg-green-600/15 text-green-600",
    warning: "bg-amber-500/15 text-amber-600",
    error: "bg-red-500/15 text-red-500",
  },
  filled: {
    default: "bg-on-surface text-surface",
    primary: "bg-primary text-on-primary",
    cover: "bg-cover/100 text-white",
    info: "bg-blue-500 text-white",
    success: "bg-green-600 text-white",
    warning: "bg-amber-500 text-white",
    error: "bg-red-500 text-white",
  },
  outline: {
    default: "border border-solid border-outline-variant text-on-surface",
    primary: "border border-solid border-primary/30 text-primary",
    cover: "border border-solid border-cover/30 text-cover",
    info: "border border-solid border-blue-500/30 text-blue-500",
    success: "border border-solid border-green-600/30 text-green-600",
    warning: "border border-solid border-amber-500/30 text-amber-600",
    error: "border border-solid border-red-500/30 text-red-500",
  },
};

const sizeClass = computed(() =>
  props.closable ? sizePresets[props.size].closable : sizePresets[props.size].base,
);
const variantClass = computed(() => variantStyles[props.variant][props.type]);
const closeBtn = computed(() => closeBtnSize[props.size]);
</script>

<template>
  <span
    class="inline-flex items-center justify-center font-medium select-none whitespace-nowrap"
    :class="[round ? 'rounded-full' : 'rounded-md', sizeClass, variantClass]"
  >
    <slot />
    <SButton
      v-if="closable"
      :type="type"
      variant="ghost"
      circle
      :size="closeBtn.btn"
      :icon-size="closeBtn.icon"
      @click.stop="$emit('close')"
    >
      <template #icon><IconLucideX /></template>
    </SButton>
  </span>
</template>
