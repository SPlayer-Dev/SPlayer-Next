<script setup lang="ts">
defineOptions({ name: "SearchPage" });

import type { PlaybackContext, Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { CoverItem } from "@/types/artist";
import { searchSongs, searchAlbums, searchArtists, searchPlaylists } from "@/apis/search";
import { useStatusStore } from "@/stores/status";
import { usePluginsStore } from "@/stores/plugins";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const plugins = usePluginsStore();

type TabKey = "songs" | "albums" | "artists" | "playlists";

const TAB_KEYS: readonly TabKey[] = ["songs", "albums", "artists", "playlists"];

const PAGE_SIZE = 50;

/** 当前生效的 tab */
const activeTab = ref<TabKey>("songs");

/** 当前生效的关键词 */
const keyword = ref("");

const tabs = computed(() => [
  { key: "songs", label: t("search.tabs.songs") },
  { key: "albums", label: t("search.tabs.albums") },
  { key: "artists", label: t("search.tabs.artists") },
  { key: "playlists", label: t("search.tabs.playlists") },
]);

const platformTabs = computed(() => [
  ...ALL_PLATFORMS.map((key) => ({ key, label: PLATFORM_SHORT_NAME[key] })),
  ...(pluginSources.value.length ? [{ key: "plugin", label: t("search.plugins") }] : []),
]);
const pluginSources = computed(() => {
  const sources = plugins.list.flatMap((info) => {
    if (!info.enabled || info.status.state !== "ready") return [];
    return Object.entries(info.status.sources)
      .filter(([, capability]) => capability.actions.includes("musicSearch"))
      .map(([source, capability]) => ({
        value: JSON.stringify([info.manifest.id, source]),
        label:
          capability.name === info.manifest.name
            ? capability.name
            : `${capability.name} · ${info.manifest.name}`,
        pluginId: info.manifest.id,
        source,
      }));
  });
  const labelCounts = new Map<string, number>();
  for (const source of sources) {
    labelCounts.set(source.label, (labelCounts.get(source.label) ?? 0) + 1);
  }
  return sources.map((source) => ({
    ...source,
    label:
      labelCounts.get(source.label)! > 1
        ? `${source.label} (${source.pluginId}/${source.source})`
        : source.label,
  }));
});
const pluginSelection = computed(() =>
  typeof route.query.plugin === "string" && typeof route.query.source === "string"
    ? { pluginId: route.query.plugin, source: route.query.source }
    : null,
);
const selectedSource = computed(() =>
  pluginSelection.value
    ? JSON.stringify([pluginSelection.value.pluginId, pluginSelection.value.source])
    : "",
);
const isPluginTab = computed(
  () =>
    pluginSources.value.length > 0 &&
    (route.query.platform === "plugin" || !!pluginSelection.value),
);
const selectedPlatform = computed(() => (isPluginTab.value ? "plugin" : status.searchPlatform));
const searchSource = computed(() =>
  isPluginTab.value ? selectedSource.value || "plugin" : status.searchPlatform,
);
const pluginAvailable = computed(
  () =>
    !isPluginTab.value ||
    !pluginSelection.value ||
    pluginSources.value.some((source) => source.value === selectedSource.value),
);
const sourceOptions = computed(() => {
  const options: { value: string; label: string }[] = [...pluginSources.value];
  if (pluginSelection.value && !pluginAvailable.value) {
    options.push({ value: selectedSource.value, label: pluginSelection.value.source });
  }
  return options;
});

interface TabState<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

/**
 * 创建搜索分类的分页状态
 * @returns 空的搜索状态
 */
const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  page: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
});

const states = {
  songs: shallowReactive(createState<Track>()),
  albums: shallowReactive(createState<CoverItem>()),
  artists: shallowReactive(createState<CoverItem>()),
  playlists: shallowReactive(createState<CoverItem>()),
};
let searchGeneration = 0;

const error = ref("");

/** 派发到 apis 层的统一调用 */
const fetchers = {
  songs: searchSongs,
  albums: searchAlbums,
  artists: searchArtists,
  playlists: searchPlaylists,
} as const;

/**
 * 读取指定搜索分类并忽略已过期的请求结果
 * @param tab - 搜索分类
 * @param append - 是否追加下一页
 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (isPluginTab.value && (!pluginSelection.value || tab !== "songs")) {
    state.loaded = true;
    error.value = "";
    return;
  }
  if (!pluginAvailable.value) {
    error.value = t("errors.NO_PLUGIN_AVAILABLE");
    return;
  }
  const generation = searchGeneration;
  if (append) {
    if (!state.loaded || state.loadingMore || !state.hasMore) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  error.value = "";
  try {
    const offset = append ? state.items.length : 0;
    const page = append ? state.page + 1 : 1;
    const selection = isPluginTab.value ? pluginSelection.value : null;
    const result = selection
      ? await window.api.plugins.search({
          ...selection,
          keyword: keyword.value,
          page,
          limit: PAGE_SIZE,
        })
      : await (fetchers[tab] as typeof searchSongs)(
          status.searchPlatform,
          keyword.value,
          offset,
          PAGE_SIZE,
        );
    if (generation !== searchGeneration) return;
    const items = result.items.map((item) => markRaw(item));
    state.items = append ? ([...state.items, ...items] as Track[]) : (items as Track[]);
    state.page = page;
    state.total = result.total;
    state.hasMore = result.hasMore;
    state.loaded = true;
  } catch (err) {
    if (generation !== searchGeneration) return;
    if (activeTab.value === tab) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (generation === searchGeneration) {
      state.loading = false;
      state.loadingMore = false;
    }
  }
};

/**
 * 清空各分类结果并使旧搜索请求失效
 */
const resetStates = (): void => {
  searchGeneration++;
  (Object.keys(states) as TabKey[]).forEach((tab) => {
    states[tab].items = [];
    states[tab].total = 0;
    states[tab].page = 0;
    states[tab].hasMore = false;
    states[tab].loaded = false;
    states[tab].loading = false;
    states[tab].loadingMore = false;
  });
  error.value = "";
};

let lastLoadedKeyword = "";
let lastLoadedSource = "";
let lastAvailable = true;

/** 仅在当前处于搜索路由时同步路由参数，避免离开到其他页面时因 query 为空而误清空状态 */
const syncFromRoute = (): void => {
  if (route.name !== "search") return;
  const q = typeof route.query.q === "string" ? route.query.q.trim() : "";
  const tab =
    typeof route.query.tab === "string" && (TAB_KEYS as readonly string[]).includes(route.query.tab)
      ? (route.query.tab as TabKey)
      : "songs";

  if (activeTab.value !== tab) error.value = "";
  activeTab.value = tab;
  keyword.value = q;

  const keywordChanged = q !== lastLoadedKeyword;
  const sourceChanged =
    searchSource.value !== lastLoadedSource || pluginAvailable.value !== lastAvailable;

  if (keywordChanged || sourceChanged) {
    lastLoadedKeyword = q;
    lastLoadedSource = searchSource.value;
    lastAvailable = pluginAvailable.value;
    resetStates();
    if (q) fetchTab(tab, false);
  } else if (q && !states[tab].loaded) {
    fetchTab(tab, false);
  }
};

watch(
  () => [route.name, route.query.q, route.query.tab, searchSource.value, pluginAvailable.value],
  syncFromRoute,
  {
    immediate: true,
  },
);

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

/**
 * 切换内置平台或插件搜索入口
 * @param key - 平台标识或插件入口
 */
const onPlatformSwitch = (key: string): void => {
  const source =
    key === "plugin"
      ? (pluginSources.value.find((item) => item.value === selectedSource.value) ??
        pluginSources.value[0])
      : undefined;
  if (key !== "plugin") status.searchPlatform = key as Platform;
  router.replace({
    query: {
      ...route.query,
      platform: key === "plugin" ? "plugin" : undefined,
      plugin: source?.pluginId,
      source: source?.source,
    },
  });
};

/**
 * 切换插件提供的搜索来源
 * @param key - 来源选项的唯一标识
 */
const onPluginSourceSwitch = (key: string | number | boolean): void => {
  const source = pluginSources.value.find((item) => item.value === key);
  if (!source) return;
  router.replace({
    query: {
      ...route.query,
      platform: "plugin",
      plugin: source.pluginId,
      source: source.source,
    },
  });
};

/** 失败后重试加载当前 tab */
const onRetry = (): void => {
  error.value = "";
  fetchTab(activeTab.value, false);
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

/** 当前 tab 已加载且为空 */
const isEmptyResult = computed(() => {
  const state = states[activeTab.value];
  return state.loaded && state.items.length === 0;
});

/** 搜索页播放来源上下文 */
const playbackContext = computed<PlaybackContext>(() => ({
  provider: isPluginTab.value ? "plugin" : status.searchPlatform,
  originId: `search:${searchSource.value}:${keyword.value}`,
  originType: "page",
  originName: keyword.value ? `${t("search.title")}: ${keyword.value}` : t("search.title"),
}));
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-end justify-between gap-4">
        <h1 class="min-w-0 flex items-baseline pr-3">
          <span class="min-w-0 truncate text-3xl font-bold text-on-surface">
            {{ keyword || t("search.title") }}
          </span>
          <span
            v-if="keyword"
            class="ml-2 shrink-0 whitespace-nowrap font-medium text-lg text-on-surface-variant/60"
          >
            {{ t("search.titleSuffix") }}
          </span>
        </h1>
        <!-- 平台切换 -->
        <div class="shrink-0 flex items-center">
          <div
            class="transition-[width] duration-200 ease-out motion-reduce:transition-none"
            :class="pluginSources.length ? 'w-56' : 'w-40'"
          >
            <STabs
              :model-value="selectedPlatform"
              :tabs="platformTabs"
              type="segment"
              round
              @update:model-value="onPlatformSwitch"
            />
          </div>
          <Transition name="plugin-source">
            <div v-if="isPluginTab" class="ml-2 w-40 shrink-0">
              <div class="w-40">
                <SSelect
                  :model-value="selectedSource"
                  :options="sourceOptions"
                  :placeholder="t('search.pluginSource')"
                  round
                  @update:model-value="onPluginSourceSwitch"
                />
              </div>
            </div>
          </Transition>
        </div>
      </div>
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
    </div>
    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearch class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center flex flex-col items-center">
        <div class="text-red-500/85 mb-4">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-3 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs">{{ error }}</div>
        </div>
        <SButton
          variant="secondary"
          size="small"
          :loading="states[activeTab].loading"
          @click="onRetry"
        >
          <template #icon>
            <IconLucideRotateCw class="size-3.5" />
          </template>
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
    <!-- 首次加载 -->
    <div v-else-if="isInitialLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
        <div class="text-sm">{{ t("common.loading") }}</div>
      </div>
    </div>
    <!-- 无结果 -->
    <div v-else-if="isEmptyResult" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearchX class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm mb-1">{{ t("search.noResults") }}</div>
        <div class="text-xs opacity-70">{{ t("search.noResultsHint") }}</div>
      </div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0">
      <SongList
        v-if="activeTab === 'songs'"
        :items="states.songs.items"
        :source="isPluginTab ? 'plugin' : status.searchPlatform"
        :playback-context="playbackContext"
        :show-size="false"
        :has-more="states.songs.hasMore"
        :loading-more="states.songs.loadingMore"
        @reach-bottom="onReachBottom('songs')"
      />
      <CoverList
        v-else-if="activeTab === 'albums'"
        :items="states.albums.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.albums.hasMore"
        :loading-more="states.albums.loadingMore"
        @click="
          (item) => navigateToAlbum(item.title, { source: status.searchPlatform, albumId: item.id })
        "
        @reach-bottom="onReachBottom('albums')"
      />
      <CoverList
        v-else-if="activeTab === 'artists'"
        :items="states.artists.items"
        type="artist"
        :min-size="120"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.artists.hasMore"
        :loading-more="states.artists.loadingMore"
        @click="
          (item) =>
            navigateToArtist(item.title, { source: status.searchPlatform, artistId: item.id })
        "
        @reach-bottom="onReachBottom('artists')"
      />
      <CoverList
        v-else
        :items="states.playlists.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.playlists.hasMore"
        :loading-more="states.playlists.loadingMore"
        @click="
          (item) => navigateToPlaylist(item.id, { source: status.searchPlatform, name: item.title })
        "
        @reach-bottom="onReachBottom('playlists')"
      />
    </div>
  </div>
</template>

<style scoped>
.plugin-source-enter-active,
.plugin-source-leave-active {
  overflow: hidden;
  transition:
    width 200ms cubic-bezier(0.2, 0, 0, 1),
    margin-left 200ms cubic-bezier(0.2, 0, 0, 1),
    opacity 150ms ease-out,
    transform 200ms cubic-bezier(0.2, 0, 0, 1);
}

.plugin-source-enter-from,
.plugin-source-leave-to {
  width: 0;
  margin-left: 0;
  opacity: 0;
  transform: translateX(4px);
}

@media (prefers-reduced-motion: reduce) {
  .plugin-source-enter-active,
  .plugin-source-leave-active {
    transition: none;
  }
}
</style>
