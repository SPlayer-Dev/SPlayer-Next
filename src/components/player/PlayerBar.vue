<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";

const status = useStatusStore();
const settings = useSettingsStore();
const { position, duration } = storeToRefs(status);

/** 是否是浮动模式 */
const isFloating = computed(() => settings.appearance.layoutMode === "floating");

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};
</script>

<template>
  <!-- 浮动模式 -->
  <div v-if="isFloating" class="relative flex items-center px-4 gap-4 min-w-0">
    <PlayerControls compact />
    <div class="flex flex-col flex-1 min-w-0 gap-1 pt-2 pb-1">
      <div class="flex items-center gap-2 min-w-0">
        <TrackInfo compact class="flex-1" />
        <span class="text-xs text-on-surface-variant/70 tabular-nums shrink-0">
          {{ formatTime(position) }} / {{ formatTime(duration) }}
        </span>
      </div>
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="10"
        :always-show-thumb="false"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTime(value) }}</template>
      </SSlider>
    </div>
    <div class="shrink-0">
      <Toolbar />
    </div>
  </div>
  <!-- 默认模式 -->
  <div v-else class="relative h-full">
    <div class="absolute left-0 right-0 top-0 -translate-y-1/2 z-10">
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="12"
        :always-show-thumb="false"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTime(value) }}</template>
      </SSlider>
    </div>
    <div class="grid grid-cols-[1fr_auto_1fr] items-center h-full px-3">
      <TrackInfo />
      <PlayerControls class="mx-15" />
      <div class="flex items-center justify-end gap-3 min-w-0">
        <span class="text-xs text-on-surface-variant tabular-nums shrink-0">
          {{ formatTime(position) }} / {{ formatTime(duration) }}
        </span>
        <Toolbar />
      </div>
    </div>
  </div>
</template>
