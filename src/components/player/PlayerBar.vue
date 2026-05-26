<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { ContentScope } from "@/types/collection";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useFavorite } from "@/composables/useFavorite";
import { useTrackMenu } from "@/composables/useTrackMenu";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";

const status = useStatusStore();
const settings = useSettingsStore();
const media = useMediaStore();
const fav = useFavorite();
const { position, duration } = storeToRefs(status);

/** 是否是浮动模式 */
const isFloating = computed(() => settings.appearance.layoutMode === "floating");

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};

/** 添加到歌单 */
const pickerOpen = ref(false);
const pickerTracks = shallowRef<Track[]>([]);
const pickerMode = computed<ContentScope>(() =>
  media.track?.source === "netease" ? "online" : "local",
);

/** 歌曲菜单 */
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(toRef(media, "track"), {
  hidePlayActions: true,
  onAddToPlaylist: (track) => {
    pickerTracks.value = [track];
    pickerOpen.value = true;
  },
});
</script>

<template>
  <!-- 浮动模式 -->
  <div v-if="isFloating" class="relative flex items-center px-4 gap-4 min-w-0">
    <PlayerControls compact />
    <div class="flex flex-col flex-1 min-w-0 gap-1 pt-2 pb-1">
      <div class="flex items-center gap-2 min-w-0">
        <TrackInfo compact class="flex-1">
          <template #title-trailing>
            <SButton
              class="-my-1"
              type="primary"
              variant="text"
              circle
              :size="24"
              :icon-size="16"
              @click="fav.toggle(media.track)"
            >
              <template #icon>
                <IconFavorite v-if="fav.isLiked(media.track)" />
                <IconFavoriteOutline v-else />
              </template>
            </SButton>
            <SDropdownMenu
              v-if="media.track"
              :items="menuItems"
              side="top"
              align="start"
              @select="onMenuSelect"
            >
              <template #trigger>
                <SButton class="-my-1" variant="text" circle :size="24" :icon-size="16">
                  <template #icon><IconLucideMoreVertical /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </template>
        </TrackInfo>
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
    <div class="grid grid-cols-[1fr_auto_1fr] items-center h-full px-3 gap-3">
      <TrackInfo>
        <template #title-trailing>
          <SButton
            class="-my-1"
            type="primary"
            variant="text"
            circle
            :size="28"
            :icon-size="18"
            @click="fav.toggle(media.track)"
          >
            <template #icon>
              <IconFavorite v-if="fav.isLiked(media.track)" />
              <IconFavoriteOutline v-else />
            </template>
          </SButton>
          <SDropdownMenu
            v-if="media.track"
            :items="menuItems"
            side="top"
            align="start"
            @select="onMenuSelect"
          >
            <template #trigger>
              <SButton class="-my-1" variant="text" circle :size="28" :icon-size="18">
                <template #icon><IconLucideMoreVertical /></template>
              </SButton>
            </template>
          </SDropdownMenu>
        </template>
      </TrackInfo>
      <PlayerControls class="mx-15" />
      <div class="flex items-center justify-end gap-3 min-w-0">
        <span class="text-xs text-on-surface-variant tabular-nums shrink-0">
          {{ formatTime(position) }} / {{ formatTime(duration) }}
        </span>
        <Toolbar />
      </div>
    </div>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>
