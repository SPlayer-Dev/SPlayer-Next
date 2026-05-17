<script setup lang="ts">
import type { TrackSource } from "@shared/types/player";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { useSettingsStore } from "@/stores/settings";
import { loadArtist as loadArtistService } from "@/services/artistLoader";
import { fetchArtistSongs } from "@/apis/user/netease";
import { navigateToAlbum } from "@/utils/navigate";
import SongList from "@/components/list/SongList.vue";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";
import artistFallback from "@/assets/images/artist.jpg";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideHourglass from "~icons/lucide/hourglass";
import IconLucideMusic from "~icons/lucide/music";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import IconLucideListChecks from "~icons/lucide/list-checks";

const { t } = useI18n();
const route = useRoute();
const { appearance } = useSettingsStore();

const tabTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

const source = route.params.source as TrackSource;
const id = route.params.id as string;

const artist = shallowRef<ArtistProfile | null>(null);
/** 正在加载（任一来源） */
const loading = ref(false);
/** 取消当次加载 */
let loadAbort: AbortController | null = null;
/** NCM 歌手歌曲分页：是否还有更多 + 加载中 */
const hasMoreSongs = ref(false);
const loadingMore = ref(false);

/** 在线头像未到位时，用任一曲目的封面顶替 */
const fallbackTrackCover = computed(() => artist.value?.tracks.find((t) => t.cover)?.cover);

/** 折叠状态 */
const collapsed = ref(false);

const handleListScroll = (event: Event) => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 10) {
    collapsed.value = true;
  } else if (collapsed.value && scrollTop === 0) {
    collapsed.value = false;
  }
};

/** 加载数据：派发到 services/artistLoader，本组件只管 ref + loading + abort */
const loadArtist = async (): Promise<void> => {
  collapsed.value = false;
  loadAbort?.abort();
  const myAbort = new AbortController();
  loadAbort = myAbort;
  loading.value = true;
  hasMoreSongs.value = false;

  try {
    await loadArtistService(source, id, {
      fallbackName: typeof route.query.name === "string" ? route.query.name : undefined,
      signal: myAbort.signal,
      onUpdate: (next) => {
        if (myAbort.signal.aborted) return;
        artist.value = next;
        // 仅 NCM 支持触底分页（artist_songs）；首屏 50 首后开放加载更多
        if (next && source === "netease" && next.tracks.length >= 50) {
          hasMoreSongs.value = true;
        }
      },
    });
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

/** 触底加载更多 NCM 歌手歌曲 */
const onReachBottom = async (): Promise<void> => {
  if (source !== "netease" || !hasMoreSongs.value || loadingMore.value || !artist.value) return;
  const current = artist.value;
  loadingMore.value = true;
  try {
    const { tracks, more } = await fetchArtistSongs(decodeURIComponent(id), current.tracks.length);
    if (loadAbort?.signal.aborted || artist.value?.id !== current.id) return;
    if (tracks.length === 0) {
      hasMoreSongs.value = false;
      return;
    }
    artist.value = {
      ...current,
      tracks: [...current.tracks, ...tracks],
      trackCount: current.tracks.length + tracks.length,
    };
    hasMoreSongs.value = more;
  } finally {
    loadingMore.value = false;
  }
};

loadArtist();

onBeforeUnmount(() => {
  loadAbort?.abort();
});

/** 总时长 */
const totalDuration = computed(() => {
  if (!artist.value) return "";
  const total = artist.value.tracks.reduce((sum, t) => sum + t.duration, 0);
  return total > 0 ? formatTime(total) : "";
});

const handlePlayAll = () => {
  if (!artist.value?.tracks.length) return;
  player.playFrom(artist.value.tracks, 0);
};

const searchQuery = ref("");

/** 歌曲列表引用 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 更多菜单 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks },
]);

const handleMoreMenu = (key: string) => {
  if (key === "batchManage") songListRef.value?.enterBatch();
};

/** 当前 tab */
const activeTab = ref("songs");

watch(activeTab, (tab) => {
  if (tab === "albums") collapsed.value = true;
});

const tabs = computed(() => {
  const items = [{ key: "songs", label: t("artist.songs") }];
  if (artist.value?.albums.length) {
    items.push({ key: "albums", label: t("artist.albums") });
  }
  return items;
});

const albumItems = computed<CoverItem[]>(() => {
  if (!artist.value?.albums.length) return [];
  return artist.value.albums.map((item) => ({
    ...item,
    subtitle: t("common.totalSongs", { count: item.trackCount }),
  }));
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部信息 -->
    <div v-if="artist" class="shrink-0 px-5 pb-2">
      <div
        class="flex mt-2 transition-[gap,margin] duration-300"
        :class="collapsed ? 'gap-3 mb-3' : 'gap-5 mb-4'"
      >
        <!-- 头像 -->
        <SImg
          :src="artist.avatar ?? fallbackTrackCover"
          :fallback="artistFallback"
          :alt="artist.name"
          class="shrink-0 rounded-full transition-[width,height] duration-300"
          :class="collapsed ? 'size-20' : 'size-40'"
        />
        <!-- 信息 -->
        <div class="flex-1 flex flex-col min-w-0 py-1">
          <div
            class="flex flex-col transition-[gap] duration-300"
            :class="collapsed ? 'gap-0.5' : 'gap-2'"
          >
            <h1
              class="font-bold text-on-surface truncate lh-normal transition-[font-size,line-height] duration-300"
              :class="collapsed ? 'text-xl' : 'text-3xl'"
            >
              {{ artist.name }}
            </h1>
            <div
              class="grid transition-[grid-template-rows,opacity] duration-300"
              :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
            >
              <div
                class="overflow-hidden flex items-center gap-3 text-sm leading-none text-on-surface-variant/50"
              >
                <span class="flex items-center gap-1">
                  <IconLucideListMusic class="shrink-0" />
                  {{ t("common.totalSongs", { count: artist.trackCount }) }}
                </span>
                <span v-if="artist.albumCount" class="flex items-center gap-1">
                  <IconLucideDisc3 class="shrink-0" />
                  {{ t("common.totalAlbums", { count: artist.albumCount }) }}
                </span>
                <span v-if="totalDuration" class="flex items-center gap-1">
                  <IconLucideHourglass class="shrink-0" />
                  {{ t("collection.totalDuration", { time: totalDuration }) }}
                </span>
              </div>
            </div>
          </div>
          <!-- 操作栏 -->
          <div class="mt-auto flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="artist.tracks.length === 0 || activeTab !== 'songs'"
                @click="handlePlayAll"
              >
                <template #icon>
                  <IconLucidePlay />
                </template>
                {{ t("common.playAll") }}
              </SButton>
              <SDropdownMenu
                :items="moreMenuItems"
                :disabled="activeTab !== 'songs'"
                align="start"
                @select="handleMoreMenu"
              >
                <template #trigger>
                  <SButton variant="secondary" circle :disabled="activeTab !== 'songs'">
                    <template #icon>
                      <IconLucideEllipsis />
                    </template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
            <SInput
              v-model="searchQuery"
              :placeholder="t('common.search')"
              :disabled="activeTab !== 'songs'"
              clearable
              round
              class="w-40 focus-within:w-56"
            >
              <template #prefix>
                <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
              </template>
            </SInput>
          </div>
        </div>
      </div>
      <!-- Tab 切换 -->
      <STabs v-model="activeTab" :tabs="tabs" type="bar" size="large" />
    </div>
    <Transition name="fade" mode="out-in" :duration="150">
      <div
        v-if="artist && artist.tracks.length > 0"
        :key="artist.id"
        class="flex-1 min-h-0 flex flex-col"
      >
        <Transition :name="tabTransitionName" mode="out-in">
          <!-- 歌曲列表 -->
          <div v-if="activeTab === 'songs'" key="songs" class="flex-1 min-h-0">
            <SongList
              ref="songListRef"
              :items="artist.tracks"
              :search-query="searchQuery"
              :source="source"
              :show-size="source === 'local'"
              :has-more="hasMoreSongs"
              :loading-more="loadingMore"
              enable-sort
              @scroll="handleListScroll"
              @change="loadArtist"
              @reach-bottom="onReachBottom"
            />
          </div>
          <!-- 专辑网格 -->
          <div v-else-if="activeTab === 'albums'" key="albums" class="flex-1 min-h-0">
            <CoverList
              :items="albumItems"
              :padding-x="20"
              :padding-bottom="24"
              @click="(item) => navigateToAlbum(item.title, { source, albumId: item.id })"
            />
          </div>
        </Transition>
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="artist" key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("collection.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
