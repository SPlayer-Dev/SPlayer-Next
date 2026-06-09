<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import * as player from "@/core/player";

withDefaults(
  defineProps<{
    /** 紧凑模式 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const status = useStatusStore();
const media = useMediaStore();
const { isPlaying, isLoading, repeatMode, shuffleMode, heartMode, fmMode } = storeToRefs(status);

const hasTrack = computed(() => !!media.track);
</script>

<template>
  <div class="flex items-center" :class="compact ? 'gap-0' : 'gap-2.5'">
    <SButton
      type="primary"
      variant="ghost"
      circle
      ripple
      :size="compact ? 32 : 38"
      @click="
        fmMode
          ? player.dislikeFmTrack()
          : heartMode
            ? player.exitHeartMode()
            : player.toggleShuffleMode()
      "
    >
      <template #icon>
        <IconLucideHeartOff v-if="fmMode" />
        <IconSpHeartMode v-else-if="heartMode" />
        <IconLucideShuffle v-else-if="shuffleMode === 'on'" />
        <IconSpPlayOrder v-else />
      </template>
    </SButton>
    <SButton
      type="primary"
      variant="ghost"
      circle
      ripple
      :size="compact ? 34 : 38"
      :disabled="!hasTrack || fmMode"
      @click="player.prevTrack()"
    >
      <template #icon><IconLucideSkipBack /></template>
    </SButton>
    <SButton
      type="primary"
      variant="secondary"
      circle
      ripple
      :class="compact ? 'mx-0.5' : 'mx-1'"
      :size="compact ? 40 : 44"
      :loading="isLoading"
      :disabled="!hasTrack && !isLoading"
      @click="player.togglePlay()"
    >
      <template #icon>
        <IconLucidePause v-if="isPlaying" />
        <IconLucidePlay v-else />
      </template>
    </SButton>
    <SButton
      type="primary"
      variant="ghost"
      circle
      ripple
      :size="compact ? 34 : 38"
      :disabled="!hasTrack"
      @click="player.nextTrack(true)"
    >
      <template #icon><IconLucideSkipForward /></template>
    </SButton>
    <SButton
      variant="ghost"
      circle
      ripple
      :size="compact ? 32 : 38"
      :disabled="fmMode"
      :class="fmMode || repeatMode === 'off' ? 'text-on-surface-variant' : 'text-primary'"
      @click="player.cycleRepeatMode()"
    >
      <template #icon>
        <IconLucideInfinity v-if="fmMode" />
        <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
        <IconLucideRepeat v-else />
      </template>
    </SButton>
  </div>
</template>
