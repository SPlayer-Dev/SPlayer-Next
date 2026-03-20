<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";

const status = useStatusStore();
const media = useMediaStore();
const { isPlaying, isLoading, position, duration } = storeToRefs(status);

/** 是否有可播放的曲目 */
const hasTrack = computed(() => !!media.track);

const togglePlay = (): void => {
  if (!hasTrack.value) return;
  if (isPlaying.value) {
    status.pause();
  } else {
    status.play();
  }
};

const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const min = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

const onSeek = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
  status.seek(value);
};
</script>

<template>
  <div class="flex items-center gap-4 h-full px-4">
    <!-- 歌曲信息 -->
    <div class="flex items-center gap-3 w-50 shrink-0">
      <img
        v-if="media.track?.cover"
        :src="media.track.cover"
        class="size-12 rounded-lg object-cover bg-surface-alt"
      />
      <div v-if="media.track" class="min-w-0 text-sm">
        <div class="truncate font-medium">{{ media.track.title }}</div>
        <div class="truncate text-xs text-on-surface-variant">
          {{ media.track.artists.map((a) => a.name).join(" / ") }}
        </div>
      </div>
    </div>

    <!-- 播放控制 + 进度 -->
    <div class="flex-1 flex flex-col items-center gap-1">
      <div class="flex items-center gap-3">
        <SButton variant="ghost" circle size="small" :disabled="!hasTrack" @click="status.stop()">
          <template #icon><IconLucideSquare /></template>
        </SButton>
        <SButton type="primary" variant="secondary" circle :loading="isLoading" :disabled="!hasTrack && !isLoading" @click="togglePlay">
          <template #icon>
            <IconLucidePause v-if="isPlaying" />
            <IconLucidePlay v-else />
          </template>
        </SButton>
      </div>
      <div class="flex items-center gap-2 w-full max-w-lg">
        <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
          formatTime(position)
        }}</span>
        <input
          type="range"
          min="0"
          :max="duration"
          step="100"
          :value="position"
          class="flex-1 accent-primary"
          @input="onSeek"
        />
        <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
          formatTime(duration)
        }}</span>
      </div>
    </div>

    <!-- 音量 -->
    <div class="flex items-center gap-2 w-36 shrink-0">
      <IconLucideVolume2 class="size-4 text-on-surface-variant shrink-0" />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="status.volume"
        class="flex-1 accent-primary"
        @input="status.setVolume(Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </div>
</template>
