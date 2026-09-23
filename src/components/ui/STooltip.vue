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
  }>(),
  {
    side: "top",
    align: "center",
    sideOffset: 6,
    delay: 100,
    disabled: false,
  },
);

const { zIndex, onOpenChange } = usePopupZIndex();
</script>

<template>
  <TooltipProvider :delay-duration="delay" :disable-hoverable-content="true">
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
          class="px-3 py-2 rounded-lg bg-surface-bright shadow-lg text-sm text-on-surface data-[state=delayed-open]:animate-popover-in data-[state=closed]:animate-popover-out"
        >
          {{ content }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
