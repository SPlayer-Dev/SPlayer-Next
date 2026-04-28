<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";

const status = useStatusStore();
const media = useMediaStore();
const { isPlaying, isLoading, position, duration, isExpanded, repeatMode, shuffleMode } =
  storeToRefs(status);

const hasTrack = computed(() => !!media.track);

/** 当前歌词文本，播放中且有匹配歌词时显示 */
const currentLyricText = computed(() => {
  if (!isPlaying.value || media.lyricIndex < 0) return null;
  const line = media.parsedLyric[media.lyricIndex];
  if (!line) return null;
  const text = line.words.map((w) => w.word).join("");
  return line.translatedLyric ? `${text}（${line.translatedLyric}）` : text;
});

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};
</script>

<template>
  <div class="relative h-full">
    <!-- 进度条 -->
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

    <!-- 主内容 -->
    <div class="grid grid-cols-[1fr_auto_1fr] items-center h-full px-3">
      <div class="flex items-center gap-3 min-w-0">
        <div
          class="relative size-14 shrink-0 rounded-lg overflow-hidden cursor-pointer group"
          @click="isExpanded = true"
        >
          <SImg :src="media.track?.cover" class="size-full" />
          <div
            class="absolute inset-0 z-10 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors duration-200"
          >
            <IconLucideChevronUp
              class="size-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            />
          </div>
        </div>
        <!-- 歌曲信息 -->
        <Transition name="slide-left" mode="out-in">
          <div v-if="media.track" :key="media.track.id" class="min-w-0">
            <SMarquee class="font-bold text-base leading-snug">{{ media.track.title }}</SMarquee>
            <Transition name="slide-up" mode="out-in">
              <SMarquee
                v-if="currentLyricText"
                :key="`lyric-${media.lyricIndex}`"
                class="text-sm text-on-surface-variant mt-1"
              >
                {{ currentLyricText }}
              </SMarquee>
              <div v-else key="artist" class="text-sm text-on-surface-variant mt-1 truncate">
                <span
                  v-for="(artist, i) in media.track.artists"
                  :key="artist.id ?? i"
                  class="cursor-pointer transition-colors hover:text-primary"
                >
                  {{ artist.name }}
                  <span v-if="i < media.track.artists.length - 1" class="mx-1 opacity-60">/</span>
                </span>
              </div>
            </Transition>
          </div>
        </Transition>
      </div>
      <!-- 播放控制 -->
      <div class="flex items-center gap-2 mx-15">
        <SButton
          variant="ghost"
          circle
          ripple
          :size="36"
          :class="shuffleMode === 'on' ? 'text-primary' : 'text-on-surface-variant'"
          @click="player.toggleShuffleMode()"
        >
          <template #icon><IconLucideShuffle /></template>
        </SButton>
        <SButton
          type="primary"
          variant="ghost"
          circle
          ripple
          :size="38"
          :disabled="!hasTrack"
          @click="player.prevTrack()"
        >
          <template #icon><IconLucideSkipBack /></template>
        </SButton>
        <SButton
          type="primary"
          variant="secondary"
          class="mx-1"
          circle
          ripple
          :size="44"
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
          :size="38"
          :disabled="!hasTrack"
          @click="player.nextTrack()"
        >
          <template #icon><IconLucideSkipForward /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
          ripple
          :size="36"
          :class="repeatMode === 'off' ? 'text-on-surface-variant' : 'text-primary'"
          @click="player.cycleRepeatMode()"
        >
          <template #icon>
            <IconLucideRepeat1 v-if="repeatMode === 'one'" />
            <IconLucideRepeat v-else />
          </template>
        </SButton>
      </div>
      <div class="flex items-center justify-end gap-3 min-w-0">
        <!-- 时间 -->
        <span class="text-xs text-on-surface-variant tabular-nums shrink-0">
          {{ formatTime(position) }} / {{ formatTime(duration) }}
        </span>
        <!-- 工具栏 -->
        <Toolbar />
      </div>
    </div>
  </div>
</template>
