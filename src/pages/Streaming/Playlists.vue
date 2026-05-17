<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { Playlist } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import { navigateToPlaylist } from "@/utils/navigate";
import CoverList from "@/components/list/CoverList.vue";

const { t } = useI18n();
const streaming = useStreamingStore();
const { playlists, loading, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });

const refresh = (): void => {
  if (!isConnected.value) return;
  streaming.fetchPlaylists();
};

watch(refreshKey, refresh);
watch(isConnected, (v) => v && refresh());
onMounted(() => {
  if (isConnected.value && playlists.value.length === 0) refresh();
});

const items = computed<CoverItem[]>(() =>
  playlists.value.map((p: Playlist) => ({
    id: p.id ?? "",
    title: p.name,
    cover: p.cover,
    subtitle: p.trackCount ? t("common.totalSongs", { count: p.trackCount }) : "",
    trackCount: p.trackCount ?? 0,
  })),
);

const handleClick = (item: CoverItem): void => {
  navigateToPlaylist(item.id, { source: "streaming", name: item.title });
};
</script>

<template>
  <div class="h-full">
    <CoverList
      v-if="playlists.length > 0"
      :items="items"
      :padding-x="20"
      :padding-top="8"
      :padding-bottom="20"
      @click="handleClick"
    />
    <div v-else class="h-full flex items-center justify-center text-on-surface-variant/50">
      <div class="text-sm">
        {{ loading ? t("common.loading") : t("streaming.empty.noResults") }}
      </div>
    </div>
  </div>
</template>
