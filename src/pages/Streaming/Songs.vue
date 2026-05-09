<script setup lang="ts">
import { useStreamingStore } from "@/stores/streaming";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideSearch from "~icons/lucide/search";

const { t } = useI18n();
const streaming = useStreamingStore();
const { songs, loading, loadingMoreSongs, hasMoreSongs, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });
const searchQuery = ref("");

const refresh = (): void => {
  if (!isConnected.value) return;
  streaming.fetchSongs();
};

// 父组件按刷新按钮时触发
watch(refreshKey, refresh);
// 连接成功时自动拉
watch(isConnected, (v) => v && refresh());
// 首次挂载：已连接且数据为空才拉（store 有缓存就直接显示，避免重复请求）
onMounted(() => {
  if (isConnected.value && songs.value.length === 0) refresh();
});

const handlePlayAll = (): void => {
  if (songs.value.length === 0) return;
  player.playFrom(songs.value, 0);
};

const handleReachBottom = (): void => {
  streaming.fetchMoreSongs();
};
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 py-2 flex items-center justify-between">
      <SButton
        type="primary"
        variant="secondary"
        round
        :disabled="songs.length === 0"
        @click="handlePlayAll"
      >
        <template #icon>
          <IconLucidePlay />
        </template>
        {{ t("common.playAll") }}
      </SButton>
      <SInput
        v-model="searchQuery"
        :placeholder="t('common.search')"
        clearable
        round
        class="w-40 focus-within:w-56"
      >
        <template #prefix>
          <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
        </template>
      </SInput>
    </div>
    <div v-if="songs.length > 0" class="flex-1 min-h-0">
      <SongList
        :items="songs"
        :search-query="searchQuery"
        source="streaming"
        @reach-bottom="handleReachBottom"
      >
        <template #footer>
          <div class="py-4 text-center text-xs text-on-surface-variant/40">
            <span v-if="loadingMoreSongs">{{ t("common.loading") }}</span>
            <span v-else-if="!hasMoreSongs">{{ t("common.noMore") }}</span>
          </div>
        </template>
      </SongList>
    </div>
    <div v-else class="flex-1 flex items-center justify-center text-on-surface-variant/50">
      <div class="text-sm">
        {{ loading ? t("common.loading") : t("streaming.empty.noResults") }}
      </div>
    </div>
  </div>
</template>
