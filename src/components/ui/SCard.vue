<script setup lang="ts">
export interface SCardProps {
  /** 卡片标题 */
  title?: string;
  /** 背景变体 */
  variant?: "default" | "primary";
  /** 是否显示边框 */
  bordered?: boolean;
  /** 内边距尺寸 */
  size?: "small" | "medium" | "large";
  /** 圆角尺寸 */
  radius?: "md" | "lg" | "xl";
  /** 鼠标悬浮高亮 */
  hoverable?: boolean;
  /** 无内边距 */
  flush?: boolean;
}

withDefaults(defineProps<SCardProps>(), {
  variant: "default",
  bordered: true,
  size: "medium",
  radius: "lg",
});

/** 变体到背景 / 边框样式的映射 */
const variantClass: Record<NonNullable<SCardProps["variant"]>, { bg: string; border: string }> = {
  default: { bg: "bg-surface-panel", border: "border-primary/20" },
  primary: { bg: "bg-primary/5", border: "border-primary/25" },
};

const sizePadding: Record<NonNullable<SCardProps["size"]>, string> = {
  small: "px-3 py-2",
  medium: "px-4 py-3",
  large: "px-5 py-4",
};

const radiusClass: Record<NonNullable<SCardProps["radius"]>, string> = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
};

const slots = useSlots();

const structured = computed(() => !!slots.header || !!slots["header-extra"] || !!slots.footer);
</script>

<template>
  <div
    class="transition-shadow duration-200"
    :class="[
      variantClass[variant].bg,
      radiusClass[radius],
      bordered && ['border border-solid', variantClass[variant].border],
      hoverable && 'cursor-pointer hover:shadow-md',
      !structured && !title && !flush && sizePadding[size],
    ]"
  >
    <!-- 结构化：头部 -->
    <template v-if="structured || title">
      <div
        class="flex items-center justify-between gap-2"
        :class="[sizePadding[size], $slots.default && 'pb-2']"
      >
        <div class="min-w-0 flex-1 text-base font-medium">
          <slot name="header">{{ title }}</slot>
        </div>
        <div v-if="$slots['header-extra']" class="shrink-0">
          <slot name="header-extra" />
        </div>
      </div>
      <!-- 主体 -->
      <div v-if="$slots.default" :class="[sizePadding[size], 'pt-0', $slots.footer && 'pb-2']">
        <slot />
      </div>
      <!-- 底部 -->
      <div v-if="$slots.footer" :class="[sizePadding[size], 'pt-0']">
        <slot name="footer" />
      </div>
    </template>

    <!-- 简单模式 -->
    <slot v-else />
  </div>
</template>
