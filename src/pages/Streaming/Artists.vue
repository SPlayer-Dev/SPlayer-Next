<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import { useStreamingStore } from "@/stores/streaming";
import { artistToCoverItem } from "@/utils/format/coverItem";
import CoverList from "@/components/list/CoverList.vue";

const { t } = useI18n();
const router = useRouter();
const streaming = useStreamingStore();
const { artists, loading, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });

const refresh = (): void => {
  if (!isConnected.value) return;
  streaming.fetchArtists();
};

watch(refreshKey, refresh);
watch(isConnected, (v) => v && refresh());
onMounted(() => {
  if (isConnected.value && artists.value.length === 0) refresh();
});

const items = computed<CoverItem[]>(() =>
  artists.value.map((a) => ({
    ...artistToCoverItem(a),
    subtitle: a.albumCount ? t("common.totalAlbums", { count: a.albumCount }) : "",
  })),
);

const handleClick = (item: CoverItem): void => {
  router.push(`/artist/streaming/${encodeURIComponent(item.id)}`);
};
</script>

<template>
  <div class="h-full">
    <CoverList
      v-if="artists.length > 0"
      :items="items"
      type="artist"
      :min-size="120"
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
