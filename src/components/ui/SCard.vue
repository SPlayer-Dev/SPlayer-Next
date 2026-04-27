<script setup lang="ts">
export interface SCardProps {
  /** 卡片标题（可被 #header 插槽覆盖） */
  title?: string;
  /** 是否显示边框 */
  bordered?: boolean;
  /** 内边距尺寸 */
  size?: "small" | "medium" | "large";
  /** 鼠标悬浮高亮 */
  hoverable?: boolean;
}

withDefaults(defineProps<SCardProps>(), {
  bordered: true,
  size: "medium",
});

const sizePadding: Record<NonNullable<SCardProps["size"]>, string> = {
  small: "px-3 py-2",
  medium: "px-4 py-3",
  large: "px-5 py-4",
};

const slots = useSlots();

const structured = computed(() => !!slots.header || !!slots["header-extra"] || !!slots.footer);
</script>

<template>
  <div
    class="rounded-lg transition-shadow duration-150"
    :class="[
      bordered && 'border border-solid border-primary/20',
      hoverable && 'hover:shadow-md',
      !structured && !title && sizePadding[size],
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
