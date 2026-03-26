<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
// import { useMediaStore } from "@/stores/media";
// import { usePlaybackTime } from "@/composables/usePlaybackTime";
// import * as player from "@/core/player";

const status = useStatusStore();
// const media = useMediaStore();
const { isExpanded } = storeToRefs(status);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div
        v-show="isExpanded"
        class="fixed inset-0 z-200 bg-surface flex flex-col items-center justify-center gap-8"
      >
        <!-- 播放背景 -->
        <PlayerBackground />
      </div>
    </Transition>
  </Teleport>
</template>
