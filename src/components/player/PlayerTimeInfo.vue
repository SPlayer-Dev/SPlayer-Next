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
      class="relative inline-grid overflow-hidden px-1.5 py-0.5 rounded-md text-xs text-on-surface-variant tabular-nums transition-colors"
      :class="status.transitioning ? 'cursor-default' : 'cursor-pointer hover:bg-on-surface/8'"
      @click="!status.transitioning && toggleTimeFormat()"
    >
      <span
        class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
        :class="status.transitioning ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'"
        :aria-hidden="status.transitioning"
      >
        {{ timeDisplay[0] }} / {{ timeDisplay[1] }}
      </span>
      <Transition
        enter-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
        leave-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
        enter-from-class="opacity-0 translate-y-1"
        leave-to-class="opacity-0 translate-y-1"
      >
        <span
          v-if="status.transitioning"
          class="player-transition-shine absolute inset-0 flex items-center justify-end pr-1.5"
          role="status"
        >
          {{ $t("player.transitioning") }}
        </span>
      </Transition>
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

<style scoped>
.player-transition-shine {
  color: transparent;
  background: linear-gradient(
    100deg,
    rgb(var(--s-on-surface) / 0.7) 40%,
    rgb(var(--s-primary)) 50%,
    rgb(var(--s-on-surface) / 0.7) 60%
  );
  background-size: 200% 100%;
  background-clip: text;
  animation: player-transition-shine 1.4s linear infinite;
}

@keyframes player-transition-shine {
  from {
    background-position: 100% center;
  }
  to {
    background-position: -100% center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-transition-shine {
    animation: none;
    background: none;
    color: rgb(var(--s-on-surface));
  }
}
</style>
