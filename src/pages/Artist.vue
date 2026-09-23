<script setup lang="ts">
import type { PlaybackContext, TrackSource } from "@shared/types/player";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { loadArtist as loadArtistService } from "@/services/artistLoader";
import { fetchArtistSongs } from "@/apis/artist/netease";
import { fetchQQMusicArtistSongs } from "@/apis/artist/qqmusic";
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
import IconMaterialSymbolsFavoriteRounded from "~icons/material-symbols/favorite-rounded";
import IconMaterialSymbolsFavoriteOutlineRounded from "~icons/material-symbols/favorite-outline-rounded";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { appearance } = useSettingsStore();
const userStore = useUserStore();

const tabTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

const source = route.params.source as TrackSource;
const id = route.params.id as string;

const artist = shallowRef<ArtistProfile | null>(null);
/** 正在加载 */
const loading = ref(false);
/** 错误信息 */
const error = ref("");
/** 取消当次加载 */
let loadAbort: AbortController | null = null;
/** 是否还有更多 */
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

/** 加载数据 */
const loadArtist = async (): Promise<void> => {
  collapsed.value = false;
  loadAbort?.abort();
  const myAbort = new AbortController();
  loadAbort = myAbort;
  loading.value = true;
  error.value = "";
  hasMoreSongs.value = false;

  try {
    await loadArtistService(source, id, {
      fallbackName: typeof route.query.name === "string" ? route.query.name : undefined,
      signal: myAbort.signal,
      onUpdate: (next) => {
        if (myAbort.signal.aborted) return;
        artist.value = next;
        if (
          next &&
          ((source === "netease" && next.tracks.length >= 50) ||
            (source === "qqmusic" && next.tracks.length < next.trackCount))
        ) {
          hasMoreSongs.value = true;
        }
      },
    });
  } catch (err) {
    if (myAbort.signal.aborted) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

/** 触底加载 */
const onReachBottom = async (): Promise<void> => {
  if (
    (source !== "netease" && source !== "qqmusic") ||
    !hasMoreSongs.value ||
    loadingMore.value ||
    !artist.value
  )
    return;
  const current = artist.value;
  loadingMore.value = true;
  try {
    const { tracks, more } =
      source === "qqmusic"
        ? await fetchQQMusicArtistSongs(decodeURIComponent(id), current.tracks.length)
        : await fetchArtistSongs(decodeURIComponent(id), current.tracks.length);
    if (loadAbort?.signal.aborted || artist.value?.id !== current.id) return;
    if (tracks.length === 0) {
      hasMoreSongs.value = false;
      return;
    }
    artist.value = {
      ...current,
      tracks: [...current.tracks, ...tracks],
      trackCount: source === "qqmusic" ? current.trackCount : current.tracks.length + tracks.length,
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

const playbackContext = computed<PlaybackContext>(() => ({
  provider: source,
  originId: decodeURIComponent(id),
  originType: "artist",
  originName: artist.value?.name,
}));

const handlePlayAll = () => {
  if (!artist.value?.tracks.length) return;
  player.playFrom(artist.value.tracks, 0, playbackContext.value);
};

/** 收藏歌手仅支持网易云 */
const canSubscribeArtist = computed(() => artist.value?.source === "netease");

/** 当前歌手是否已收藏（依据用户收藏歌手列表） */
const isArtistSubscribed = computed(() => {
  const current = artist.value;
  if (!current || current.source !== "netease") return false;
  return userStore.artists.some((item) => String(item.id) === String(current.id));
});

/** 收藏操作进行中 */
const artistSubBusy = ref(false);

const handleToggleSubscribe = async (): Promise<void> => {
  const current = artist.value;
  if (!current || current.source !== "netease" || artistSubBusy.value) return;
  artistSubBusy.value = true;
  try {
    await userStore.toggleArtistSubscribe(current.id, !isArtistSubscribed.value);
  } catch (err) {
    toast.error(err instanceof Error && err.message ? err.message : t("liked.toast.failed"));
  } finally {
    artistSubBusy.value = false;
  }
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

type ArtistTab = "songs" | "albums";

const ARTIST_TAB_KEYS: readonly ArtistTab[] = ["songs", "albums"];

/** 当前 tab */
const activeTab = computed<ArtistTab>(() => {
  const tab = route.query.tab;
  return typeof tab === "string" && (ARTIST_TAB_KEYS as readonly string[]).includes(tab)
    ? (tab as ArtistTab)
    : "songs";
});

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

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
              <SButton
                v-if="canSubscribeArtist"
                variant="secondary"
                round
                :disabled="artistSubBusy"
                @click="handleToggleSubscribe"
              >
                <template #icon>
                  <IconMaterialSymbolsFavoriteRounded v-if="isArtistSubscribed" />
                  <IconMaterialSymbolsFavoriteOutlineRounded v-else />
                </template>
                {{ t(isArtistSubscribed ? "collection.unsubscribe" : "collection.subscribe") }}
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
              data-search-input
            >
              <template #prefix>
                <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
              </template>
            </SInput>
          </div>
        </div>
      </div>
      <!-- Tab 切换 -->
      <STabs
        :model-value="activeTab"
        :tabs="tabs"
        type="bar"
        size="large"
        @update:model-value="onTabSwitch"
      />
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
              :playback-context="playbackContext"
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
      <!-- 错误态 -->
      <div v-else-if="error" key="error" class="flex-1 flex items-center justify-center px-6">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-4 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs mb-4">{{ error }}</div>
          <SButton type="primary" variant="secondary" @click="loadArtist">
            <template #icon><IconLucideRefreshCw /></template>
            {{ t("common.retry") }}
          </SButton>
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
