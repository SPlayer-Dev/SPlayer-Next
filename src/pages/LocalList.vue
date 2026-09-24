<script setup lang="ts">
defineOptions({ name: "LocalList" });

import type { CoverItem } from "@/types/artist";
import type { PlaybackContext, Track } from "@shared/types/player";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { AlbumSummary, ArtistSummary, GenreSummary } from "@shared/types/library";
import { useLibraryStore } from "@/stores/library";
import CoverList from "@/components/list/CoverList.vue";
import { navigateToAlbum, navigateToArtist, navigateToGenre } from "@/utils/navigate";
import * as player from "@/core/player";
import IconLucideUsers from "~icons/lucide/users";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideGuitar from "~icons/lucide/guitar";
import IconLucideArrowUpDown from "~icons/lucide/arrow-up-down";

type Mode = "artist" | "album" | "genre";
type SortMode = "default" | "name" | "trackCount";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const { artistAvatars } = storeToRefs(libraryStore);

const mode: Mode =
  route.name === "album-list" ? "album" : route.name === "genre-list" ? "genre" : "artist";

const sortMode = ref<SortMode>("default");

const sortOptions = computed<SSelectOption[]>(() => [
  { value: "default", label: t("songList.sort.default") },
  { value: "name", label: t("songList.sort.byName") },
  { value: "trackCount", label: t("songList.sort.byTrackCount") },
]);

const source = shallowRef<ArtistSummary[] | AlbumSummary[] | GenreSummary[]>([]);

/** 组装最终列表 */
const items = computed<CoverItem[]>(() => {
  const list: CoverItem[] =
    mode === "artist"
      ? (source.value as ArtistSummary[]).map((item) => ({
          id: encodeURIComponent(item.name),
          title: item.name,
          cover: artistAvatars.value[item.name.trim().toLowerCase()] ?? item.cover,
          subtitle: t("common.totalSongs", { count: item.trackCount }),
          trackCount: item.trackCount,
        }))
      : mode === "genre"
        ? (source.value as GenreSummary[]).map((item) => ({
            id: encodeURIComponent(item.name),
            title: item.name,
            cover: item.cover,
            subtitle: t("common.totalSongs", { count: item.trackCount }),
            trackCount: item.trackCount,
          }))
        : (source.value as AlbumSummary[]).map((item) => ({
            id: encodeURIComponent(item.name),
            title: item.name,
            cover: item.cover,
            subtitle: item.artist || t("song.unknownArtist"),
            trackCount: item.trackCount,
          }));
  if (sortMode.value === "name") {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode.value === "trackCount") {
    list.sort((a, b) => b.trackCount - a.trackCount || a.title.localeCompare(b.title));
  }
  return list;
});

const config = computed(() => {
  if (mode === "artist") {
    return {
      title: t("artist.label"),
      countIcon: IconLucideUsers,
      countLabel: t("artist.totalArtists", { count: items.value.length }),
      emptyIcon: IconLucideUserRound,
      coverType: "artist" as const,
      minSize: 120,
      selectWidth: "w-32",
    };
  }
  if (mode === "genre") {
    return {
      title: t("genre.label"),
      countIcon: IconLucideGuitar,
      countLabel: t("genre.totalGenres", { count: items.value.length }),
      emptyIcon: IconLucideGuitar,
      coverType: "default" as const,
      minSize: 140,
      selectWidth: "w-40",
    };
  }
  return {
    title: t("album.label"),
    countIcon: IconLucideDisc3,
    countLabel: t("common.totalAlbums", { count: items.value.length }),
    emptyIcon: IconLucideDisc3,
    coverType: "default" as const,
    minSize: 140,
    selectWidth: "w-40",
  };
});

const handleClick = (item: CoverItem): void => {
  if (mode === "artist") navigateToArtist(item.title);
  else if (mode === "genre") navigateToGenre(item.title);
  else navigateToAlbum(item.title);
};

/** 正在加载曲目的卡片，避免重复点击 */
const playingItem = ref("");

/** 取卡片对应的曲目列表 */
const loadItemTracks = async (item: CoverItem): Promise<Track[]> => {
  if (mode === "artist") {
    const profile = await libraryStore.getArtistProfile(item.title);
    return profile?.tracks ?? [];
  }
  const collection =
    mode === "genre"
      ? await libraryStore.getGenreCollection(item.title)
      : await libraryStore.getAlbumCollection(item.title);
  return collection?.tracks ?? [];
};

/** 点击封面播放按钮：直接播放该歌手/专辑/流派下的全部曲目 */
const handlePlay = async (item: CoverItem): Promise<void> => {
  if (playingItem.value === item.id) return;
  playingItem.value = item.id;
  try {
    const tracks = await loadItemTracks(item);
    if (tracks.length === 0) return;
    const context: PlaybackContext = {
      provider: "local",
      originId: item.title,
      originType: mode,
      originName: item.title,
    };
    await player.playFrom(tracks, 0, context);
  } finally {
    playingItem.value = "";
  }
};

onMounted(async () => {
  source.value =
    mode === "artist"
      ? await libraryStore.getArtistList()
      : mode === "genre"
        ? await libraryStore.getGenreList()
        : await libraryStore.getAlbumList();
  // 拉取当前列表中尚未缓存的歌手头像
  if (mode === "artist") libraryStore.loadArtistAvatars();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ config.title }}</h1>
          <span
            v-if="items.length > 0"
            class="flex items-center gap-1 text-sm text-on-surface-variant/50"
          >
            <component :is="config.countIcon" class="size-3.5" />
            {{ config.countLabel }}
          </span>
        </div>
        <div
          v-if="items.length > 0"
          class="flex items-center gap-2 text-sm text-on-surface-variant/70"
        >
          <IconLucideArrowUpDown class="size-3.5 shrink-0" />
          <span class="shrink-0">{{ t("songList.sort.mode") }}</span>
          <div :class="[config.selectWidth, 'shrink-0']">
            <SSelect v-model="sortMode" :options="sortOptions" />
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 min-h-0">
      <CoverList
        v-if="items.length > 0"
        :items="items"
        :type="config.coverType"
        :min-size="config.minSize"
        :padding-x="20"
        :padding-bottom="24"
        playable
        @click="handleClick"
        @play="handlePlay"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <component :is="config.emptyIcon" class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm mb-1">{{ t("library.noLocalData") }}</div>
          <div class="text-xs mb-4 opacity-70">{{ t("library.noLocalDataHint") }}</div>
          <SButton type="primary" variant="secondary" @click="router.push('/library')">
            <template #icon><IconLucideMusic /></template>
            {{ t("library.goLibrary") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
