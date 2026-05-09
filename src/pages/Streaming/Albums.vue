<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { Album } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import CoverList from "@/components/list/CoverList.vue";

const { t } = useI18n();
const router = useRouter();
const streaming = useStreamingStore();
const { albums, loading, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });

const refresh = (): void => {
  if (!isConnected.value) return;
  streaming.fetchAlbums();
};

watch(refreshKey, refresh);
watch(isConnected, (v) => v && refresh());
onMounted(() => {
  if (isConnected.value && albums.value.length === 0) refresh();
});

const items = computed<CoverItem[]>(() =>
  albums.value.map((a: Album) => ({
    id: a.id ?? "",
    title: a.name,
    cover: a.cover,
    subtitle: a.artist ?? "",
    trackCount: a.trackCount ?? 0,
  })),
);

const handleClick = (item: CoverItem): void => {
  router.push(`/collection/streaming/album/${encodeURIComponent(item.id)}`);
};
</script>

<template>
  <div class="h-full">
    <CoverList
      v-if="albums.length > 0"
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
