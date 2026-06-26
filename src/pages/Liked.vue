<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { ContentScope } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useLibraryStore } from "@/stores/library";
import { useUserStore } from "@/stores/user";
import { useStatusStore } from "@/stores/status";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";

const { t } = useI18n();
const library = useLibraryStore();
const user = useUserStore();
const status = useStatusStore();

/** 当前 tab */
const tab = computed({
  get: () => status.likedPageTab,
  set: (v: ContentScope) => (status.likedPageTab = v),
});

const tabs = computed(() => [
  { key: "local", label: t("liked.tabs.local") },
  { key: "online", label: t("liked.tabs.online") },
]);

const searchQuery = ref("");

/** 本地喜欢列表 */
const localTracks = computed<Track[]>(() => {
  const byId = new Map<string, Track>(library.tracks.map((track) => [track.id, track]));
  const list: Track[] = [];
  for (const id of library.likedOrderedIds) {
    const track = byId.get(id);
    if (track) list.push(track);
  }
  return list;
});

watch(
  () => [tab.value, user.isLoggedIn, user.likedPlaylistId] as const,
  ([nextTab, loggedIn, plId]) => {
    if (nextTab !== "online" || !loggedIn || !plId) return;
    user.ensureLikedPlaylist();
  },
  { immediate: true },
);

/** 当前 tab 的曲目 */
const currentTracks = computed<Track[]>(() =>
  tab.value === "local" ? localTracks.value : user.likedPlaylistTracks,
);

const handlePlayAll = (): void => {
  if (currentTracks.value.length === 0) return;
  player.playFrom(currentTracks.value, 0);
};

// 直进 /liked（没先访问 Library 页）时本地库未初始化，需要手动触发
onMounted(() => {
  if (!library.initialized) library.load();
});

/** SongList 引用：本地 / 在线两个分支共用同一 ref，因为同时只挂载一个 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 更多菜单：刷新仅在线 tab 有意义；批量管理两边都可 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = [];
  if (tab.value === "online") {
    items.push({
      key: "refresh",
      label: t("common.refreshCache"),
      icon: markRaw(IconLucideRefreshCw),
    });
  }
  items.push({
    key: "batch",
    label: t("songList.batch.manage"),
    icon: markRaw(IconLucideListChecks),
  });
  return items;
});

const handleMoreMenu = (key: string): void => {
  if (key === "refresh") {
    user.ensureLikedPlaylist(true);
  } else if (key === "batch") {
    songListRef.value?.enterBatch();
  }
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("liked.title") }}</h1>
          <span
            v-if="currentTracks.length > 0"
            class="text-sm text-on-surface-variant/50 flex items-center gap-1"
          >
            <IconLucideMusic class="size-3.5" />
            {{ t("common.totalSongs", { count: currentTracks.length }) }}
          </span>
        </div>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="currentTracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle>
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
          >
            <template #prefix>
              <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
            </template>
          </SInput>
          <div class="w-48">
            <STabs v-model="tab" :tabs="tabs" type="segment" round />
          </div>
        </div>
      </div>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 本地 tab -->
      <div v-if="tab === 'local' && localTracks.length > 0" key="local-list" class="flex-1 min-h-0">
        <SongList
          ref="songListRef"
          :items="localTracks"
          :search-query="searchQuery"
          :show-size="false"
          source="local"
          enable-sort
        />
      </div>
      <div
        v-else-if="tab === 'local'"
        key="local-empty"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/50">
          <IconMaterialSymbolsFavoriteOutlineRounded class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("liked.empty.local") }}</div>
        </div>
      </div>
      <!-- 在线 tab -->
      <div
        v-else-if="tab === 'online' && !user.isLoggedIn"
        key="online-login"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/50">
          <IconMaterialSymbolsFavoriteOutlineRounded class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("liked.needLogin") }}</div>
        </div>
      </div>
      <div
        v-else-if="tab === 'online' && user.likedPlaylistTracks.length > 0"
        key="online-list"
        class="flex-1 min-h-0"
      >
        <SongList
          ref="songListRef"
          :items="user.likedPlaylistTracks"
          :search-query="searchQuery"
          source="netease"
          :collection-id="user.likedPlaylistId ?? undefined"
          collection-type="playlist"
          enable-sort
        />
      </div>
      <div
        v-else-if="tab === 'online' && user.likedPlaylistLoading"
        key="online-loading"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <div v-else key="online-empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconMaterialSymbolsFavoriteOutlineRounded class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("liked.empty.online") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
