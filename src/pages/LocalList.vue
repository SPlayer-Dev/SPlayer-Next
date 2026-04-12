<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { AlbumSummary, ArtistSummary } from "@shared/types/library";
import { useLibraryStore } from "@/stores/library";
import CoverList from "@/components/list/CoverList.vue";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import IconLucideUsers from "~icons/lucide/users";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideArrowUpDown from "~icons/lucide/arrow-up-down";

type Mode = "artist" | "album";
type SortMode = "default" | "name" | "trackCount";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const { artistAvatars } = storeToRefs(libraryStore);

const mode: Mode = route.name === "album-list" ? "album" : "artist";

const sortMode = ref<SortMode>("default");

const sortOptions = computed<SSelectOption[]>(() => [
  { value: "default", label: t("songList.sort.default") },
  { value: "name", label: t("songList.sort.byName") },
  { value: "trackCount", label: t("songList.sort.byTrackCount") },
]);

const source = shallowRef<ArtistSummary[] | AlbumSummary[]>([]);

/** 组装最终列表 */
const items = computed<CoverItem[]>(() => {
  const list: CoverItem[] =
    mode === "artist"
      ? source.value.map((item: ArtistSummary) => ({
          id: encodeURIComponent(item.name),
          title: item.name,
          cover: artistAvatars.value[item.name.trim().toLowerCase()],
          subtitle: t("artist.totalSongs", { count: item.trackCount }),
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

const config = computed(() =>
  mode === "artist"
    ? {
        title: t("artist.label"),
        countIcon: IconLucideUsers,
        countLabel: t("artist.totalArtists", { count: items.value.length }),
        emptyIcon: IconLucideUserRound,
        coverType: "artist" as const,
        minSize: 120,
        selectWidth: "w-32",
      }
    : {
        title: t("album.label"),
        countIcon: IconLucideDisc3,
        countLabel: t("album.totalAlbums", { count: items.value.length }),
        emptyIcon: IconLucideDisc3,
        coverType: "default" as const,
        minSize: 140,
        selectWidth: "w-40",
      },
);

const handleClick = (item: CoverItem): void => {
  if (mode === "artist") navigateToArtist(item.title);
  else navigateToAlbum(item.title);
};

onMounted(async () => {
  source.value =
    mode === "artist" ? await libraryStore.getArtistList() : await libraryStore.getAlbumList();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface">{{ config.title }}</h1>
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
    <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
      <CoverList
        v-if="items.length > 0"
        :items="items"
        :type="config.coverType"
        :min-size="config.minSize"
        @click="handleClick"
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
