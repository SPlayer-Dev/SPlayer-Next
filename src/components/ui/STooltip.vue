<script setup lang="ts">
import { usePopupZIndex } from "@/composables/useZIndex";

withDefaults(
  defineProps<{
    /** 提示文本 */
    content: string;
    /** 弹出位置 */
    side?: "top" | "right" | "bottom" | "left";
    /** 对齐方式 */
    align?: "start" | "center" | "end";
    /** 与触发元素的距离（px） */
    sideOffset?: number;
    /** 打开延迟（ms） */
    delay?: number;
    /** 是否禁用 */
    disabled?: boolean;
    /** 封面主题 */
    cover?: boolean;
    /** 点击触发元素时是否关闭 */
    closeOnClick?: boolean;
  }>(),
  {
    side: "top",
    align: "center",
    sideOffset: 6,
    delay: 100,
    disabled: false,
    closeOnClick: false,
  },
);

const { zIndex, onOpenChange } = usePopupZIndex();
</script>

<template>
  <TooltipProvider
    :delay-duration="delay"
    :disable-hoverable-content="true"
    :disable-closing-trigger="!closeOnClick"
  >
    <TooltipRoot :disabled="disabled" @update:open="onOpenChange">
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :align="align"
          :side-offset="sideOffset"
          :avoid-collisions="true"
          :collision-padding="12"
          :style="{ zIndex }"
          :class="[
            'px-3 py-2 rounded-lg shadow-lg text-sm data-[state=delayed-open]:animate-popover-in data-[state=closed]:animate-popover-out',
            cover
              ? 'bg-black/55 backdrop-blur-xl backdrop-saturate-160 border border-solid border-white/10 text-cover'
              : 'bg-surface-bright text-on-surface',
          ]"
        >
          {{ content }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
