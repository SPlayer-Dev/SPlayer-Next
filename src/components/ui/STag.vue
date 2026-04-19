<script setup lang="ts">
export interface STagProps {
  /** 颜色类型 */
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
  /** 变体：soft 软底、filled 纯色、outline 描边 */
  variant?: "soft" | "filled" | "outline";
  /** 尺寸 */
  size?: "tiny" | "small" | "medium";
  /** 胶囊形 */
  round?: boolean;
}

const props = withDefaults(defineProps<STagProps>(), {
  type: "primary",
  variant: "soft",
  size: "small",
});

const sizePresets: Record<NonNullable<STagProps["size"]>, string> = {
  tiny: "h-4 px-1 text-[10px]",
  small: "h-5 px-1.5 text-xs",
  medium: "h-6 px-2 text-sm",
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
    cover: "bg-cover text-white",
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

const sizeClass = computed(() => sizePresets[props.size]);
const variantClass = computed(() => variantStyles[props.variant][props.type]);
</script>

<template>
  <span
    class="inline-flex items-center justify-center font-medium leading-none select-none whitespace-nowrap"
    :class="[round ? 'rounded-full' : 'rounded-md', sizeClass, variantClass]"
  >
    <slot />
  </span>
</template>
