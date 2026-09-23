<script setup lang="ts">
defineOptions({ name: "History" });

import type { PlaybackContext } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useHistoryStore } from "@/stores/history";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucideTrash2 from "~icons/lucide/trash-2";

const { t } = useI18n();
const history = useHistoryStore();

const playbackContext = computed<PlaybackContext>(() => ({
  originId: "history",
  originType: "page",
  originName: t("history.title"),
}));

const searchQuery = ref("");

const handlePlayAll = (): void => {
  if (history.tracks.length === 0) return;
  player.playFrom(history.tracks, 0, playbackContext.value);
};

const clearConfirmOpen = ref(false);

/** 更多菜单 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "clear",
    label: t("history.clear"),
    icon: markRaw(IconLucideTrash2),
  },
]);

const handleMoreMenu = (key: string): void => {
  if (key === "clear") clearConfirmOpen.value = true;
};

const handleClear = (): void => {
  history.clear();
  clearConfirmOpen.value = false;
};

onMounted(() => {
  history.load();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("history.title") }}</h1>
          <span
            v-if="history.tracks.length > 0"
            class="text-sm text-on-surface-variant/50 flex items-center gap-1"
          >
            <IconLucideMusic class="size-3.5" />
            {{ t("common.totalSongs", { count: history.tracks.length }) }}
          </span>
        </div>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="history.tracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle :disabled="history.tracks.length === 0">
                <template #icon>
                  <IconLucideEllipsis />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
        <div class="flex items-center gap-3">
          <SInput
            v-model="searchQuery"
            :placeholder="t('common.search')"
            clearable
            round
            class="w-40 focus-within:w-56"
            data-search-input
          >
            <template #prefix>
              <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
            </template>
          </SInput>
        </div>
      </div>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <div v-if="history.tracks.length > 0" key="list" class="flex-1 min-h-0">
        <SongList
          :items="history.tracks"
          :search-query="searchQuery"
          :playback-context="playbackContext"
          :show-size="false"
          enable-sort
        />
      </div>
      <div v-else key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideHistory class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("history.empty") }}</div>
        </div>
      </div>
    </Transition>
    <!-- 清空确认 -->
    <SDialog v-model:open="clearConfirmOpen" :title="t('history.clearConfirmTitle')">
      {{ t("history.clearConfirmContent") }}
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" variant="secondary" @click="handleClear">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
