<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { searchSongs, searchAlbums, searchArtists, searchPlaylists } from "@/apis/search";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";

const { t } = useI18n();
const route = useRoute();

type TabKey = "songs" | "albums" | "artists" | "playlists";

const activeTab = ref<TabKey>("songs");

const PAGE_SIZE = 50;

/** URL query 中的关键词 */
const keyword = computed(() => {
  const q = route.query.q;
  return typeof q === "string" ? q.trim() : "";
});

const tabs = computed(() => [
  { key: "songs", label: t("search.tabs.songs") },
  { key: "albums", label: t("search.tabs.albums") },
  { key: "artists", label: t("search.tabs.artists") },
  { key: "playlists", label: t("search.tabs.playlists") },
]);

interface TabState<T> {
  items: T[];
  total: number;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  loadingMore: false,
});

const states = reactive({
  songs: createState<Track>(),
  albums: createState<CoverItem>(),
  artists: createState<CoverItem>(),
  playlists: createState<CoverItem>(),
});

const error = ref("");

/** 派发到 apis 层的统一调用 */
const fetchers = {
  songs: searchSongs,
  albums: searchAlbums,
  artists: searchArtists,
  playlists: searchPlaylists,
} as const;

/** 拉取指定 tab：append=true 时追加下一页，否则首屏拉取 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (append) {
    if (!state.loaded || state.loadingMore || state.items.length >= state.total) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  error.value = "";
  try {
    const offset = append ? state.items.length : 0;
    const result = await (fetchers[tab] as typeof searchSongs)(
      "netease",
      keyword.value,
      offset,
      PAGE_SIZE,
    );
    if (append) {
      (state.items as Track[]).push(...(result.items as Track[]));
    } else {
      state.items = result.items as never;
    }
    state.total = result.total;
    state.loaded = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    state.loadingMore = false;
  }
};

/** 关键词变化：重置所有 tab 状态并拉当前 tab */
watch(
  keyword,
  () => {
    (Object.keys(states) as TabKey[]).forEach((tab) => {
      states[tab].items = [];
      states[tab].total = 0;
      states[tab].loaded = false;
      states[tab].loading = false;
      states[tab].loadingMore = false;
    });
    error.value = "";
    if (keyword.value) fetchTab(activeTab.value, false);
  },
  { immediate: true },
);

/** 切换 tab：未拉过则按需请求 */
watch(activeTab, (tab) => {
  if (keyword.value && !states[tab].loaded) fetchTab(tab, false);
});

const onTabSwitch = (key: string): void => {
  activeTab.value = key as TabKey;
};

/** 滚动触底加载下一页 */
const onReachBottom = (tab: TabKey): void => {
  fetchTab(tab, true);
};

/** 当前 tab 首屏加载中 */
const isInitialLoading = computed(() => {
  const state = states[activeTab.value];
  return state.loading && !state.loaded;
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <h1 class="mt-2 mb-4 truncate">
        <span class="text-3xl font-bold text-on-surface">
          {{ keyword || t("search.title") }}
        </span>
        <span v-if="keyword" class="ml-2 text-lg text-on-surface-variant/60">
          {{ t("search.titleSuffix") }}
        </span>
      </h1>
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
    </div>

    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center text-on-surface-variant/50">
      <div class="text-center">
        <IconLucideSearch class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center text-red-500/80 px-6">
      <div class="text-sm break-all text-center">{{ error }}</div>
    </div>
    <!-- 首次加载 -->
    <div
      v-else-if="isInitialLoading"
      class="flex-1 flex items-center justify-center text-on-surface-variant/50"
    >
      <div class="text-sm">{{ t("common.loading") }}</div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0">
      <template v-if="activeTab === 'songs'">
        <SongList
          v-if="states.songs.items.length > 0"
          :items="states.songs.items"
          source="online"
          :show-size="false"
          @reach-bottom="onReachBottom('songs')"
        />
        <div v-else class="h-full flex items-center justify-center text-on-surface-variant/50">
          <div class="text-sm">{{ t("search.noResults") }}</div>
        </div>
      </template>
      <template v-else-if="activeTab === 'albums'">
        <CoverList
          v-if="states.albums.items.length > 0"
          :items="states.albums.items"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          @reach-bottom="onReachBottom('albums')"
        />
        <div v-else class="h-full flex items-center justify-center text-on-surface-variant/50">
          <div class="text-sm">{{ t("search.noResults") }}</div>
        </div>
      </template>
      <template v-else-if="activeTab === 'artists'">
        <CoverList
          v-if="states.artists.items.length > 0"
          :items="states.artists.items"
          type="artist"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          @reach-bottom="onReachBottom('artists')"
        />
        <div v-else class="h-full flex items-center justify-center text-on-surface-variant/50">
          <div class="text-sm">{{ t("search.noResults") }}</div>
        </div>
      </template>
      <template v-else>
        <CoverList
          v-if="states.playlists.items.length > 0"
          :items="states.playlists.items"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          @reach-bottom="onReachBottom('playlists')"
        />
        <div v-else class="h-full flex items-center justify-center text-on-surface-variant/50">
          <div class="text-sm">{{ t("search.noResults") }}</div>
        </div>
      </template>
    </div>
  </div>
</template>
