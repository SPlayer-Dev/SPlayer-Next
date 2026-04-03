<script setup lang="ts">
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal, TooltipProvider } from "reka-ui";

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
    delay: 200,
    disabled: false,
  },
);
</script>

<template>
  <TooltipProvider :delay-duration="delay" :disable-hoverable-content="true">
    <TooltipRoot :disabled="disabled">
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :align="align"
          :side-offset="sideOffset"
          :avoid-collisions="true"
          class="z-300 px-2.5 py-1.5 rounded-lg bg-surface-bright border border-solid border-outline-variant/30 shadow-lg text-xs text-on-surface data-[state=delayed-open]:animate-popover-in data-[state=closed]:animate-popover-out"
        >
          {{ content }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
