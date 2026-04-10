<script setup lang="ts">
import type { TrackSource } from "@shared/types/player";
import type { ArtistProfile } from "@/types/artist";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
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
const libraryStore = useLibraryStore();
const { appearance } = useSettingsStore();

const tabTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

const source = computed(() => route.params.source as TrackSource);
const id = computed(() => route.params.id as string);
const isCurrentRoute = computed(() => route.name === "artist");

const artist = shallowRef<ArtistProfile | null>(null);

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
const loadArtist = async () => {
  if (!isCurrentRoute.value) return;
  collapsed.value = false;
  if (source.value === "local") {
    if (!libraryStore.initialized) await libraryStore.load();
    const artistName = decodeURIComponent(id.value);
    artist.value = libraryStore.getArtistProfile(artistName);
    // 获取歌手头像
    if (artist.value && !artist.value.avatar) {
      const res = await window.api.library.fetchArtistAvatar(artistName);
      if (res.success && res.data && artist.value?.name === artistName) {
        artist.value = { ...artist.value, avatar: res.data };
      }
    }
  }
  // TODO: online
};

watch([isCurrentRoute, source, id], () => {
  if (!isCurrentRoute.value) return;
  loadArtist();
}, { immediate: true });

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
          :src="artist.avatar"
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
                  {{ t("artist.totalSongs", { count: artist.trackCount }) }}
                </span>
                <span v-if="artist.albumCount" class="flex items-center gap-1">
                  <IconLucideDisc3 class="shrink-0" />
                  {{ t("artist.totalAlbums", { count: artist.albumCount }) }}
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
                {{ t("collection.playAll") }}
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
              enable-sort
              @scroll="handleListScroll"
              @change="loadArtist"
            />
          </div>
          <!-- 专辑网格 -->
          <div v-else-if="activeTab === 'albums'" key="albums" class="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-6">
            <CoverList :items="artist.albums" @click="(item) => navigateToAlbum(item.title)" />
          </div>
        </Transition>
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
