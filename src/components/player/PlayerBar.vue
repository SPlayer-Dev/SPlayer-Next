<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { usePluginsStore } from "@/stores/plugins";
import { useFavorite } from "@/composables/useFavorite";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { useDownload } from "@/composables/useDownload";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";
import type { PluginPlayerBarButtonIcon, PluginSafeTrack } from "@shared/types/plugin";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideMoreHorizontal from "~icons/lucide/more-horizontal";
import IconLucideBookmark from "~icons/lucide/bookmark";
import IconLucideExternalLink from "~icons/lucide/external-link";
import IconLucideHeart from "~icons/lucide/heart";
import IconLucideRadio from "~icons/lucide/radio";
import IconLucideSend from "~icons/lucide/send";
import IconLucideUpload from "~icons/lucide/upload";

const status = useStatusStore();
const settings = useSettingsStore();
const media = useMediaStore();
const plugins = usePluginsStore();
const fav = useFavorite();
const { position, duration } = storeToRefs(status);
const { playerBarButtons } = storeToRefs(plugins);

/** 是否是浮动模式 */
const isFloating = computed(() => settings.appearance.layoutMode === "floating");

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};

/** 添加到歌单 */
const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

/** 歌曲菜单 */
const { enqueue: enqueueDownload } = useDownload();
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(toRef(media, "track"), {
  hidePlayActions: true,
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});

const pluginIconMap = {
  send: IconLucideSend,
  upload: IconLucideUpload,
  radio: IconLucideRadio,
  "external-link": IconLucideExternalLink,
  bookmark: IconLucideBookmark,
  heart: IconLucideHeart,
} satisfies Record<PluginPlayerBarButtonIcon, Component>;

const commandLoading = ref(new Set<string>());

const safeTrack = computed<PluginSafeTrack | null>(() => {
  const track = media.track;
  if (!track) return null;
  return {
    id: track.id,
    source: track.source,
    title: track.title,
    artists: track.artists.map((artist) => artist.name).join(", "),
    album: track.album?.name,
    duration: track.duration,
    cover: track.cover,
  };
});

const commandKey = (pluginId: string, commandId: string): string => `${pluginId}:${commandId}`;

const isCommandLoading = (pluginId: string, commandId: string): boolean =>
  commandLoading.value.has(commandKey(pluginId, commandId));

const invokePluginButton = async (pluginId: string, commandId: string): Promise<void> => {
  const key = commandKey(pluginId, commandId);
  if (commandLoading.value.has(key)) return;
  commandLoading.value = new Set(commandLoading.value).add(key);
  try {
    const result = await plugins.invokeUiCommand(pluginId, commandId, { track: safeTrack.value });
    toast.success(result.message || "已完成");
  } catch (err) {
    toast.error(err instanceof Error && err.message ? err.message : "插件命令执行失败");
  } finally {
    const next = new Set(commandLoading.value);
    next.delete(key);
    commandLoading.value = next;
  }
};
</script>

<template>
  <!-- 浮动模式 -->
  <div v-if="isFloating" class="relative flex items-center px-4 gap-4 min-w-0">
    <PlayerControls compact />
    <div class="flex flex-col flex-1 min-w-0 gap-1 pt-2 pb-1">
      <div class="flex items-center gap-2 min-w-0">
        <TrackInfo compact class="flex-1">
          <template #title-trailing>
            <div class="flex items-center shrink-0">
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
                  <SIconSwap :active="fav.isLiked(media.track)">
                    <template #on><IconFavorite /></template>
                    <template #off><IconFavoriteOutline /></template>
                  </SIconSwap>
                </template>
              </SButton>
              <SButton
                v-for="button in playerBarButtons"
                :key="`${button.pluginId}:${button.id}`"
                class="-my-1"
                type="primary"
                variant="text"
                circle
                :size="24"
                :icon-size="16"
                :title="button.tooltip || button.label"
                :disabled="!safeTrack"
                :loading="isCommandLoading(button.pluginId, button.id)"
                @click="invokePluginButton(button.pluginId, button.id)"
              >
                <template #icon>
                  <component :is="pluginIconMap[button.icon]" />
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
                  <SButton
                    class="-my-1"
                    type="primary"
                    variant="text"
                    circle
                    :size="24"
                    :icon-size="16"
                  >
                    <template #icon><IconLucideMoreHorizontal /></template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
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
          <div class="flex items-center shrink-0">
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
                <SIconSwap :active="fav.isLiked(media.track)">
                  <template #on><IconFavorite /></template>
                  <template #off><IconFavoriteOutline /></template>
                </SIconSwap>
              </template>
            </SButton>
            <SButton
              v-for="button in playerBarButtons"
              :key="`${button.pluginId}:${button.id}`"
              class="-my-1"
              type="primary"
              variant="text"
              circle
              :size="28"
              :icon-size="18"
              :title="button.tooltip || button.label"
              :disabled="!safeTrack"
              :loading="isCommandLoading(button.pluginId, button.id)"
              @click="invokePluginButton(button.pluginId, button.id)"
            >
              <template #icon>
                <component :is="pluginIconMap[button.icon]" />
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
                <SButton
                  class="-my-1"
                  type="primary"
                  variant="text"
                  circle
                  :size="28"
                  :icon-size="18"
                >
                  <template #icon><IconLucideMoreHorizontal /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>
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
