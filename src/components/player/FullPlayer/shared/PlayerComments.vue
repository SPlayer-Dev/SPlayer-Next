<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useFullPlayer } from "../context";
import FullPlayerComments from "../FullPlayerComments.vue";

interface Props {
  /** 展示模式：half 占左半屏窄列，full 全屏多列 */
  mode: "half" | "full";
  /** half 模式下面板占位宽度 */
  width?: string;
}

defineProps<Props>();
const status = useStatusStore();
const { immersive } = useFullPlayer();
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]"
    leave-to-class="opacity-0"
  >
    <div
      v-if="status.fullCommentsOpen"
      class="absolute py-4 z-6 transition-[inset,width,padding] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="
        mode === 'half'
          ? 'inset-y-0 left-0 pl-[clamp(32px,4vw,64px)] pr-[clamp(20px,2.5vw,40px)]'
          : 'inset-0 w-full px-[clamp(32px,5vw,80px)]'
      "
      :style="mode === 'half' ? { width } : undefined"
    >
      <FullPlayerComments :mode="mode" :immersive="immersive" @close="status.toggleFullComments" />
    </div>
  </Transition>
</template>
