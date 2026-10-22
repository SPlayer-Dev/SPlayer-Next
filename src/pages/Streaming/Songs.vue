<script setup lang="ts">
defineOptions({ name: "StreamingSongs" });

import { useStreamingStore } from "@/stores/streaming";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";

const { t } = useI18n();
const streaming = useStreamingStore();
const { songs, loading, isConnected } = storeToRefs(streaming);

const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });
const searchQuery = ref("");
const favoritesOnly = ref(false);
const visibleSongs = computed(() =>
  favoritesOnly.value ? songs.value.filter(streaming.isFavorite) : songs.value,
);

/**
 * 刷新当前服务器媒体库
 * @param force - 是否重新读取服务端快照
 */
const refresh = (force = false): void => {
  if (!isConnected.value) return;
  streaming.refreshLibrary(force);
};

// 父组件按刷新按钮时触发
watch(refreshKey, () => refresh(true));
// 连接成功时自动拉
watch(isConnected, (v) => v && refresh());
// 首次挂载：已连接且数据为空才拉（store 有缓存就直接显示，避免重复请求）
onMounted(() => {
  if (isConnected.value && songs.value.length === 0) refresh();
});

/** 播放当前筛选范围内的歌曲 */
const handlePlayAll = (): void => {
  if (visibleSongs.value.length === 0) return;
  player.playFrom(visibleSongs.value);
};
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 py-2 flex items-center justify-between">
      <SButton
        type="primary"
        variant="secondary"
        round
        :disabled="visibleSongs.length === 0"
        @click="handlePlayAll"
      >
        <template #icon>
          <IconLucidePlay />
        </template>
        {{ t("common.playAll") }}
      </SButton>
      <div class="flex items-center gap-2">
        <SButton
          :type="favoritesOnly ? 'primary' : 'default'"
          variant="secondary"
          round
          class="min-h-10"
          :aria-pressed="favoritesOnly"
          @click="favoritesOnly = !favoritesOnly"
        >
          <template #icon><IconLucideHeart /></template>
          {{ t("streaming.favoritesOnly") }}
        </SButton>
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
    <div v-if="visibleSongs.length > 0" class="flex-1 min-h-0">
      <SongList :items="visibleSongs" :search-query="searchQuery" source="streaming" />
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm">
          {{
            loading
              ? t("common.loading")
              : t(favoritesOnly ? "streaming.empty.noFavorites" : "streaming.empty.noResults")
          }}
        </div>
      </div>
    </div>
  </div>
</template>
