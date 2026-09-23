<script setup lang="ts">
defineOptions({ name: "StreamingPlaylists" });

import type { CoverItem } from "@/types/artist";
import { useStreamingStore } from "@/stores/streaming";
import { navigateToPlaylist } from "@/utils/navigate";
import { playlistToCoverItem } from "@/utils/format/coverItem";

const { t } = useI18n();
const streaming = useStreamingStore();
const { playlists, loading, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });

const refresh = (force = false): void => {
  if (!isConnected.value) return;
  streaming.refreshLibrary(force);
};

watch(refreshKey, () => refresh(true));
watch(isConnected, (v) => v && refresh());
onMounted(() => {
  if (isConnected.value && playlists.value.length === 0) refresh();
});

const items = computed<CoverItem[]>(() =>
  playlists.value.map((p) => ({
    ...playlistToCoverItem(p),
    subtitle: p.trackCount ? t("common.totalSongs", { count: p.trackCount }) : "",
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
    <div v-else class="h-full flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideListMusic class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm">
          {{ loading ? t("common.loading") : t("streaming.empty.noResults") }}
        </div>
      </div>
    </div>
  </div>
</template>
