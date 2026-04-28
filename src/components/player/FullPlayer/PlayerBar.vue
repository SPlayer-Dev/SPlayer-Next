<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";
import IconLucideSliders from "~icons/lucide/sliders-horizontal";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideRepeat2 from "~icons/lucide/repeat-2";

const { t } = useI18n();
const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlaying, isLoading, position, duration, isExpanded, repeatMode, shuffleMode } =
  storeToRefs(status);
const { isDesktopLyricOpen } = storeToRefs(settings);

const hasTrack = computed(() => !!media.track);

const toggleDesktopLyric = (): void => {
  window.api.window.toggleDesktopLyric().catch(() => {});
};

const equalizerOpen = ref(false);
const speedOpen = ref(false);
const autoCloseOpen = ref(false);
const abLoopOpen = ref(false);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "equalizer",
    label: t("equalizer.title"),
    icon: IconLucideSliders,
  },
  {
    key: "speed",
    label: t("speed.title"),
    icon: IconLucideGauge,
  },
  {
    key: "abLoop",
    label: t("abLoop.title"),
    icon: IconLucideRepeat2,
  },
  {
    key: "autoClose",
    label: t("autoClose.title"),
    icon: IconLucideClock,
  },
]);

const onMoreMenuSelect = (key: string): void => {
  if (key === "equalizer") equalizerOpen.value = true;
  else if (key === "speed") speedOpen.value = true;
  else if (key === "abLoop") abLoopOpen.value = true;
  else if (key === "autoClose") autoCloseOpen.value = true;
};

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
      <!-- 左侧 -->
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

      <!-- 时间 + 音量 -->
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
            :thumb-size="12"
            :track-height="3"
            always-show-thumb
            class="flex-1"
            @change="player.setVolume($event)"
          />
        </div>
        <!-- 桌面歌词按钮 -->
        <SButton
          variant="ghost"
          circle
          :size="36"
          :class="isDesktopLyricOpen ? 'text-primary' : 'text-on-surface-variant'"
          @click="toggleDesktopLyric"
        >
          <template #icon><IconLucideSubtitles /></template>
        </SButton>
        <!-- 播放列表按钮 -->
        <SButton
          variant="ghost"
          circle
          :size="36"
          class="text-on-surface-variant"
          @click="status.playlistOpen = true"
        >
          <template #icon><IconLucideListMusic /></template>
        </SButton>
        <!-- 更多 -->
        <SDropdownMenu :items="moreMenuItems" side="top" align="end" @select="onMoreMenuSelect">
          <template #trigger>
            <SButton variant="ghost" circle :size="36" class="text-on-surface-variant">
              <template #icon><IconLucideMoreVertical /></template>
            </SButton>
          </template>
        </SDropdownMenu>
      </div>
    </div>
    <!-- 均衡器 -->
    <EqualizerDialog v-model:open="equalizerOpen" />
    <!-- 播放速度 -->
    <SpeedDialog v-model:open="speedOpen" />
    <!-- AB 循环 -->
    <AbLoopDialog v-model:open="abLoopOpen" />
    <!-- 定时关闭 -->
    <AutoCloseDialog v-model:open="autoCloseOpen" />
  </div>
</template>
