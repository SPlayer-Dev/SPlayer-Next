<script setup lang="ts">
import { vRipple } from "@/directives/ripple";

export interface SButtonProps {
  /** 按钮类型 */
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
  /** 按钮变体 */
  variant?: "filled" | "outline" | "bordered" | "secondary" | "tertiary" | "ghost" | "text";
  /** 虚线边框（仅 outline / bordered 生效） */
  dashed?: boolean;
  /** 全圆角胶囊形 */
  round?: boolean;
  /** 纯圆形（等宽高） */
  circle?: boolean;
  /** 尺寸 */
  size?: "tiny" | "small" | "medium" | "large";
  /** 禁用 */
  disabled?: boolean;
  /** 加载中（禁止点击，显示 spinner） */
  loading?: boolean;
  /** 块级按钮 */
  block?: boolean;
  /** 加粗字体 */
  strong?: boolean;
  /** 涟漪效果 */
  ripple?: boolean;
}

const props = withDefaults(defineProps<SButtonProps>(), {
  type: "default",
  variant: "filled",
  size: "medium",
});

const isDisabled = computed(() => props.disabled || props.loading);

const enableRipple = computed(
  () => (props.ripple && !props.disabled && !props.loading) || undefined,
);

const sizeClass = computed(() =>
  props.circle
    ? {
        tiny: "w-6 h-6 text-xs",
        small: "w-8 h-8 text-sm",
        medium: "w-9 h-9 text-sm",
        large: "w-10 h-10 text-base",
      }[props.size]
    : {
        tiny: "px-1.5 h-6 text-xs",
        small: "px-2.5 h-8 text-sm",
        medium: "px-3.5 h-9 text-sm",
        large: "px-4.5 h-10 text-base",
      }[props.size],
);

const iconSizeClass = computed(
  () => ({ tiny: "size-3.5", small: "size-4", medium: "size-4.5", large: "size-5" })[props.size],
);

const variantStyles = {
  filled: {
    default:
      "bg-on-surface text-surface not-disabled:hover:bg-on-surface/90 not-disabled:active:bg-on-surface/80",
    primary:
      "bg-primary text-on-primary not-disabled:hover:bg-primary/90 not-disabled:active:bg-primary/80",
    cover: "bg-cover text-white not-disabled:hover:bg-cover/90 not-disabled:active:bg-cover/80",
    info: "bg-blue-500 text-white not-disabled:hover:bg-blue-500/90 not-disabled:active:bg-blue-500/80",
    success:
      "bg-green-600 text-white not-disabled:hover:bg-green-600/90 not-disabled:active:bg-green-600/80",
    warning:
      "bg-amber-500 text-white not-disabled:hover:bg-amber-500/90 not-disabled:active:bg-amber-500/80",
    error:
      "bg-red-500 text-white not-disabled:hover:bg-red-500/90 not-disabled:active:bg-red-500/80",
  },
  outline: {
    default:
      "has-border border-outline-variant text-on-surface not-disabled:hover:bg-on-surface/6 not-disabled:active:bg-on-surface/10",
    primary:
      "has-border border-primary/15 bg-primary/5 text-primary not-disabled:hover:bg-primary/10 not-disabled:active:bg-primary/16",
    cover:
      "has-border border-cover/15 bg-cover/5 text-cover not-disabled:hover:bg-cover/10 not-disabled:active:bg-cover/16",
    info: "has-border border-blue-500/15 bg-blue-500/5 text-blue-500 not-disabled:hover:bg-blue-500/10 not-disabled:active:bg-blue-500/16",
    success:
      "has-border border-green-600/15 bg-green-600/5 text-green-600 not-disabled:hover:bg-green-600/10 not-disabled:active:bg-green-600/16",
    warning:
      "has-border border-amber-500/15 bg-amber-500/5 text-amber-600 not-disabled:hover:bg-amber-500/10 not-disabled:active:bg-amber-500/16",
    error:
      "has-border border-red-500/15 bg-red-500/5 text-red-500 not-disabled:hover:bg-red-500/10 not-disabled:active:bg-red-500/16",
  },
  bordered: {
    default:
      "has-border border-outline-variant text-on-surface not-disabled:hover:border-outline not-disabled:active:border-on-surface/30",
    primary:
      "has-border border-primary/30 text-primary not-disabled:hover:border-primary/20 not-disabled:active:border-primary/14",
    cover:
      "has-border border-cover/30 text-cover not-disabled:hover:border-cover/20 not-disabled:active:border-cover/14",
    info: "has-border border-blue-500/30 text-blue-500 not-disabled:hover:border-blue-500/20 not-disabled:active:border-blue-500/14",
    success:
      "has-border border-green-600/30 text-green-600 not-disabled:hover:border-green-600/20 not-disabled:active:border-green-600/14",
    warning:
      "has-border border-amber-500/30 text-amber-600 not-disabled:hover:border-amber-500/20 not-disabled:active:border-amber-500/14",
    error:
      "has-border border-red-500/30 text-red-500 not-disabled:hover:border-red-500/20 not-disabled:active:border-red-500/14",
  },
  secondary: {
    default:
      "bg-on-surface/12 text-on-surface not-disabled:hover:bg-on-surface/18 not-disabled:active:bg-on-surface/24",
    primary:
      "bg-primary/16 text-primary not-disabled:hover:bg-primary/22 not-disabled:active:bg-primary/28",
    cover: "bg-cover/16 text-cover not-disabled:hover:bg-cover/22 not-disabled:active:bg-cover/28",
    info: "bg-blue-500/16 text-blue-500 not-disabled:hover:bg-blue-500/22 not-disabled:active:bg-blue-500/28",
    success:
      "bg-green-600/16 text-green-600 not-disabled:hover:bg-green-600/22 not-disabled:active:bg-green-600/28",
    warning:
      "bg-amber-500/16 text-amber-600 not-disabled:hover:bg-amber-500/22 not-disabled:active:bg-amber-500/28",
    error:
      "bg-red-500/16 text-red-500 not-disabled:hover:bg-red-500/22 not-disabled:active:bg-red-500/28",
  },
  tertiary: {
    default:
      "bg-on-surface/5 text-on-surface not-disabled:hover:bg-on-surface/10 not-disabled:active:bg-on-surface/16",
    primary:
      "bg-primary/8 text-primary not-disabled:hover:bg-primary/14 not-disabled:active:bg-primary/20",
    cover: "bg-cover/8 text-cover not-disabled:hover:bg-cover/14 not-disabled:active:bg-cover/20",
    info: "bg-blue-500/8 text-blue-500 not-disabled:hover:bg-blue-500/14 not-disabled:active:bg-blue-500/20",
    success:
      "bg-green-600/8 text-green-600 not-disabled:hover:bg-green-600/14 not-disabled:active:bg-green-600/20",
    warning:
      "bg-amber-500/8 text-amber-600 not-disabled:hover:bg-amber-500/14 not-disabled:active:bg-amber-500/20",
    error:
      "bg-red-500/8 text-red-500 not-disabled:hover:bg-red-500/14 not-disabled:active:bg-red-500/20",
  },
  ghost: {
    default:
      "text-on-surface not-disabled:hover:bg-on-surface/8 not-disabled:active:bg-on-surface/14",
    primary: "text-primary not-disabled:hover:bg-primary/10 not-disabled:active:bg-primary/16",
    cover: "text-cover not-disabled:hover:bg-cover/10 not-disabled:active:bg-cover/16",
    info: "text-blue-500 not-disabled:hover:bg-blue-500/10 not-disabled:active:bg-blue-500/16",
    success:
      "text-green-600 not-disabled:hover:bg-green-600/10 not-disabled:active:bg-green-600/16",
    warning:
      "text-amber-600 not-disabled:hover:bg-amber-500/10 not-disabled:active:bg-amber-500/16",
    error: "text-red-500 not-disabled:hover:bg-red-500/10 not-disabled:active:bg-red-500/16",
  },
  text: {
    default: "text-on-surface not-disabled:hover:text-primary",
    primary: "text-primary not-disabled:hover:text-primary/70",
    cover: "text-cover not-disabled:hover:text-cover/70",
    info: "text-blue-500 not-disabled:hover:text-blue-400",
    success: "text-green-600 not-disabled:hover:text-green-500",
    warning: "text-amber-600 not-disabled:hover:text-amber-500",
    error: "text-red-500 not-disabled:hover:text-red-400",
  },
};

/** 计算按钮的变体类 */
const variantClass = computed(() => {
  const classes: string[] = [variantStyles[props.variant][props.type]];
  if (props.dashed && (props.variant === "outline" || props.variant === "bordered")) {
    classes.push("border-dashed");
  }
  return classes;
});
</script>

<template>
  <button
    v-ripple="enableRipple"
    :disabled="isDisabled"
    class="s-button inline-flex items-center justify-center gap-1.5 font-sans select-none outline-none cursor-pointer transition-[color,background-color,border-color,opacity] duration-200 disabled:cursor-not-allowed disabled:op-50"
    :class="[
      block && 'w-full',
      strong && 'font-semibold',
      circle || round ? 'rounded-full' : 'rounded-1.5',
      sizeClass,
      variantClass,
    ]"
  >
    <span v-if="$slots.icon || loading" class="shrink-0 flex items-center justify-center overflow-hidden *:size-full" :class="iconSizeClass">
      <SLoading v-if="loading" />
      <slot v-else name="icon" />
    </span>
    <slot />
  </button>
</template>

<style>
:where(.s-button) {
  border: none;
  background: transparent;
}

:where(.s-button.has-border) {
  border: 1px solid;
}
</style>
