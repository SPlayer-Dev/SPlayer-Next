<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useTimeFormat } from "@/composables/useTimeFormat";

withDefaults(
  defineProps<{
    /** 紧凑模式 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const status = useStatusStore();
const { speed, abLoop } = storeToRefs(status);

/** 是否开启倍速 */
const isSpeedActive = computed(() => speed.value !== 1.0);
/** 是否开启 AB 循环 */
const isAbLoopActive = computed(() => abLoop.value.enable);

const { timeDisplay, toggleTimeFormat } = useTimeFormat();

/** 倍速面板 */
const speedOpen = ref(false);
/** AB 循环面板 */
const abLoopOpen = ref(false);
</script>

<template>
  <div class="flex flex-col items-end shrink-0">
    <span
      class="text-xs text-on-surface-variant tabular-nums cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-on-surface/8"
      @click="toggleTimeFormat"
    >
      {{ timeDisplay[0] }} / {{ timeDisplay[1] }}
    </span>
    <div
      v-if="isSpeedActive || isAbLoopActive"
      class="flex items-center justify-center gap-1 w-full"
      :class="compact ? 'mt-0.5' : 'mt-1'"
    >
      <STag
        v-if="isSpeedActive"
        type="primary"
        size="tiny"
        class="cursor-pointer"
        @click="speedOpen = true"
      >
        {{ speed }}x
      </STag>
      <STag
        v-if="isAbLoopActive"
        type="primary"
        size="tiny"
        class="cursor-pointer"
        @click="abLoopOpen = true"
      >
        AB
      </STag>
    </div>
  </div>
  <SpeedDialog v-model:open="speedOpen" />
  <AbLoopDialog v-model:open="abLoopOpen" />
</template>
