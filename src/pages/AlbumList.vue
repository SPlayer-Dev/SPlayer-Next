<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useLibraryStore } from "@/stores/library";
import CoverList from "@/components/list/CoverList.vue";
import { navigateToAlbum } from "@/utils/navigate";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideArrowUpDown from "~icons/lucide/arrow-up-down";

type SortMode = "default" | "name" | "trackCount";

const { t } = useI18n();
const router = useRouter();
const libraryStore = useLibraryStore();
const { initialized } = storeToRefs(libraryStore);

const sortMode = ref<SortMode>("default");

const sortOptions = computed<SSelectOption[]>(() => [
  { value: "default", label: t("songList.sort.default") },
  { value: "name", label: t("songList.sort.byName") },
  { value: "trackCount", label: t("songList.sort.byTrackCount") },
]);

const albums = computed<CoverItem[]>(() => {
  const list = libraryStore.getAlbumList().map((item) => ({
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

onMounted(async () => {
  if (!initialized.value) await libraryStore.load();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface">{{ t("album.label") }}</h1>
          <span
            v-if="albums.length > 0"
            class="flex items-center gap-1 text-sm text-on-surface-variant/50"
          >
            <IconLucideDisc3 class="size-3.5" />
            {{ t("album.totalAlbums", { count: albums.length }) }}
          </span>
        </div>
        <div
          v-if="albums.length > 0"
          class="flex items-center gap-2 text-sm text-on-surface-variant/70"
        >
          <IconLucideArrowUpDown class="size-3.5 shrink-0" />
          <span class="shrink-0">{{ t("songList.sort.mode") }}</span>
          <div class="w-40 shrink-0">
            <SSelect v-model="sortMode" :options="sortOptions" />
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
      <CoverList
        v-if="albums.length > 0"
        :items="albums"
        :min-size="140"
        :gap="16"
        @click="(item) => navigateToAlbum(item.title)"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideDisc3 class="size-12 mx-auto mb-3 opacity-30" />
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
