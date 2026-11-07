<script setup lang="ts">
import type { QualityLevel } from "@/utils/quality";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useFavorite } from "@/composables/useFavorite";
import { useDownload, buildDownloadQualityItems } from "@/composables/useDownload";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { useProgressLyric } from "@/composables/useProgressLyric";
import * as player from "@/core/player";
import { setPlayerExpanded } from "@/services/playerTransition";
import { useFullPlayer } from "../../context";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const fav = useFavorite();
const { enqueue: enqueueDownload } = useDownload();
const { t } = useI18n();
const { isPlaying, isLoading, position, duration, repeatMode, shuffleMode, heartMode, fmMode } =
  storeToRefs(status);
const { immersive, onBarEnter, onBarLeave } = useFullPlayer();

const { timeDisplay, toggleTimeFormat } = useTimeFormat();
const { snapToNearestLyric } = useProgressLyric();

/** 加载中的歌曲使用队列当前项兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const hasTrack = computed(() => !!displayTrack.value);

const canDownload = computed(
  () =>
    !!displayTrack.value &&
    displayTrack.value.source !== "local" &&
    displayTrack.value.source !== "plugin" &&
    settings.system.download.enabled,
);

const downloadQualityItems = computed(() =>
  buildDownloadQualityItems(t("download.qualityDefault")),
);

const onDownloadSelect = (key: string): void => {
  if (!displayTrack.value) return;
  void enqueueDownload(displayTrack.value, key ? { quality: key as QualityLevel } : {});
};

const onSeekDragEnd = (value: number): void => {
  player.seek(snapToNearestLyric(value));
};

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

const showComments = (): void => {
  if (displayTrack.value) status.showComments(displayTrack.value);
};
</script>

<template>
  <div
    data-player-layout="bottom-bar"
    class="absolute bottom-0 inset-x-0 h-20 z-10 flex items-center gap-4 px-4 transition-opacity duration-400"
    :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
    @mouseenter="onBarEnter"
    @mouseleave="onBarLeave"
  >
    <div class="flex-1 min-w-0 flex items-center justify-start gap-2">
      <SButton type="cover" variant="ghost" size="large" circle @click="setPlayerExpanded(false)">
        <template #icon><IconLucideChevronDown /></template>
      </SButton>
      <SButton
        v-if="displayTrack?.source !== 'plugin'"
        type="cover"
        variant="ghost"
        size="large"
        circle
        :disabled="!hasTrack || !fav.isSupported(displayTrack)"
        @click="fav.toggle(displayTrack)"
      >
        <template #icon>
          <SIconSwap :active="fav.isLiked(displayTrack)">
            <template #on><IconMaterialSymbolsFavoriteRounded /></template>
            <template #off><IconMaterialSymbolsFavoriteOutlineRounded /></template>
          </SIconSwap>
        </template>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        size="large"
        circle
        :disabled="!hasTrack"
        @click="showComments"
      >
        <template #icon><IconLucideMessageCircle /></template>
      </SButton>
      <SButton
        v-if="displayTrack?.source === 'local' || displayTrack?.source === 'netease'"
        type="cover"
        variant="ghost"
        size="large"
        circle
        @click="displayTrack && openPicker([displayTrack])"
      >
        <template #icon><IconLucideListPlus /></template>
      </SButton>
      <SDropdownMenu
        v-if="canDownload"
        :items="downloadQualityItems"
        cover
        side="top"
        align="start"
        @select="onDownloadSelect"
      >
        <template #trigger>
          <SButton type="cover" variant="ghost" size="large" circle>
            <template #icon><IconLucideDownload /></template>
          </SButton>
        </template>
      </SDropdownMenu>
    </div>
    <div class="shrink-0 flex flex-col items-center gap-1 w-[clamp(360px,35%,480px)]">
      <div class="flex items-center gap-3">
        <SButton
          type="cover"
          variant="ghost"
          circle
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
          type="cover"
          variant="ghost"
          circle
          :disabled="!hasTrack || fmMode"
          @click="player.prevTrack()"
        >
          <template #icon><IconLucideSkipBack /></template>
        </SButton>
        <SButton
          type="cover"
          variant="secondary"
          size="large"
          circle
          :loading="isLoading"
          :disabled="!hasTrack && !isLoading"
          @click="player.togglePlay()"
        >
          <template #icon>
            <SIconSwap :active="isPlaying">
              <template #on><IconLucidePause /></template>
              <template #off><IconLucidePlay /></template>
            </SIconSwap>
          </template>
        </SButton>
        <SButton
          type="cover"
          variant="ghost"
          circle
          :disabled="!hasTrack"
          @click="player.nextTrack()"
        >
          <template #icon><IconLucideSkipForward /></template>
        </SButton>
        <SButton
          type="cover"
          variant="ghost"
          circle
          :disabled="fmMode"
          :class="fmMode ? 'opacity-40' : 'opacity-100'"
          @click="player.cycleRepeatMode()"
        >
          <template #icon>
            <IconLucideInfinity v-if="fmMode" />
            <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
            <IconLucideRepeat v-else />
          </template>
        </SButton>
      </div>
      <div class="flex items-center gap-2 w-full">
        <span
          class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
          @click="toggleTimeFormat"
        >
          {{ timeDisplay[0] }}
        </span>
        <SSlider
          :model-value="position"
          :glow="status.transitioning"
          :min="0"
          :max="duration"
          :step="100"
          :always-show-thumb="false"
          cover
          class="flex-1"
          @drag-end="onSeekDragEnd"
        />
        <span
          class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
          @click="toggleTimeFormat"
        >
          {{ timeDisplay[1] }}
        </span>
      </div>
    </div>
    <div class="flex-1 min-w-0 flex items-center justify-end">
      <Toolbar cover />
    </div>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>
