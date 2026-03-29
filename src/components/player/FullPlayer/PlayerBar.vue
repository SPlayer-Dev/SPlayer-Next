<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import * as player from "@/core/player";

const status = useStatusStore();
const media = useMediaStore();
const theme = useThemeStore();
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

const togglePlay = (): void => {
  if (!hasTrack.value) return;
  if (isPlaying.value) {
    player.pause();
  } else {
    player.play();
  }
};

const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const min = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};
</script>

<template>
  <div class="relative h-full">
    <!-- 进度条：绝对定位骑在播放栏上边缘 -->
    <div class="absolute left-0 right-0 top-0 -translate-y-1/2 z-10">
      <SSlider
        :model-value="position"
        :min="0"
        :max="duration"
        :step="100"
        :track-height="3"
        :thumb-size="12"
        @drag-end="onSeekDragEnd"
      >
        <template #popover="{ value }">{{ formatTime(value) }}</template>
      </SSlider>
    </div>

    <!-- 三栏 grid 布局：左右等宽 1fr，中间 auto，保证控制按钮绝对居中 -->
    <div class="grid grid-cols-[1fr_auto_1fr] items-center h-full px-3">
      <!-- 左侧：封面 + 歌曲信息 -->
      <div class="flex items-center gap-3 min-w-0">
        <SImg
          :src="media.track?.cover"
          class="size-14 shrink-0 rounded-lg cursor-pointer"
          @load="theme.updateCoverColor($event)"
          @click="isExpanded = true"
        />
        <!-- 歌曲信息：切歌时从左侧滑入 -->
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

      <!-- 中间：播放控制 -->
      <div class="flex items-center gap-2 mx-15">
        <SButton
          variant="ghost"
          circle
          :size="36"
          :class="shuffleMode === 'on' ? 'text-primary' : 'text-on-surface-variant'"
          @click="player.toggleShuffleMode()"
        >
          <template #icon><IconLucideShuffle /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
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
          :size="44"
          :loading="isLoading"
          :disabled="!hasTrack && !isLoading"
          @click="togglePlay"
        >
          <template #icon>
            <IconLucidePause v-if="isPlaying" />
            <IconLucidePlay v-else />
          </template>
        </SButton>
        <SButton
          variant="ghost"
          circle
          :size="38"
          :disabled="!hasTrack"
          @click="player.nextTrack()"
        >
          <template #icon><IconLucideSkipForward /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
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

      <!-- 右侧：时间 + 音量 -->
      <div class="flex items-center justify-end gap-3 min-w-0">
        <span class="text-xs text-on-surface-variant tabular-nums shrink-0">
          {{ formatTime(position) }} / {{ formatTime(duration) }}
        </span>
        <div class="flex items-center gap-2 w-28 shrink-0">
          <IconLucideVolume2 class="size-4 text-on-surface-variant shrink-0" />
          <SSlider
            :model-value="status.volume"
            :min="0"
            :max="1"
            :step="0.01"
            always-show-thumb
            :thumb-size="12"
            :track-height="3"
            class="flex-1"
            @change="player.setVolume($event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
