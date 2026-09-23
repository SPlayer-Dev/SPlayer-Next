<script setup lang="ts">
import type { Component } from "vue";
import type { Track } from "@shared/types/player";
import type { TopAlbum, TopArtist, TopTrack } from "@shared/types/stats";
import * as player from "@/core/player";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import { formatCompact } from "@/utils/format";
import { useLibraryStore } from "@/stores/library";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUser from "~icons/lucide/user";

/** 榜单卡片内的排行项 */
interface RankItem {
  /** 封面 */
  cover?: string;
  /** 标题 */
  title: string;
  /** 辅助信息 */
  subtitle?: string;
  /** 累计播放次数 */
  plays: number;
  /** 代表曲目 */
  track: Track;
  /** 在线平台歌手 ID */
  artistId?: string;
}

interface RankSection {
  id: "songs" | "albums" | "artists";
  title: string;
  icon: Component;
  circle: boolean;
  items: RankItem[];
  onClick: (item: RankItem) => void;
}

const props = defineProps<{
  /** 最常听的歌曲 */
  songs: TopTrack[];
  /** 最常听的专辑 */
  albums: TopAlbum[];
  /** 最常听的歌手 */
  artists: TopArtist[];
  /** 数据是否仍在加载 */
  loading: boolean;
}>();

const { t, locale } = useI18n();
const libraryStore = useLibraryStore();

/** 歌曲榜：保留 track 供点击播放 */
const songItems = computed<RankItem[]>(() =>
  props.songs.map((item) => ({
    cover: item.track.cover,
    title: item.track.title,
    subtitle: item.track.artists.map((artist) => artist.name).join(" / "),
    plays: item.playCount,
    track: item.track,
  })),
);

/** 专辑榜 */
const albumItems = computed<RankItem[]>(() =>
  props.albums.map((item) => ({
    cover: item.track.album?.cover ?? item.track.cover,
    title: item.track.album?.name ?? "",
    subtitle: item.track.artists.map((artist) => artist.name).join(" / "),
    plays: item.playCount,
    track: item.track,
  })),
);

/** 歌手榜 */
const artistItems = computed<RankItem[]>(() =>
  props.artists.map((item) => ({
    cover:
      item.track.source === "local"
        ? (libraryStore.getArtistAvatar(item.artist.name) ?? item.artist.avatar ?? item.track.cover)
        : (item.artist.avatar ?? item.track.cover),
    title: item.artist.name,
    plays: item.playCount,
    track: item.track,
    artistId: item.artist.id,
  })),
);

/** 三类榜单配置 */
const sections = computed<RankSection[]>(() => [
  {
    id: "songs",
    title: t("stats.topSongs"),
    icon: IconLucideMusic,
    circle: false,
    items: songItems.value,
    onClick: (item) => playSong(item.track),
  },
  {
    id: "albums",
    title: t("stats.topAlbums"),
    icon: IconLucideDisc3,
    circle: false,
    items: albumItems.value,
    onClick: (item) =>
      navigateToAlbum(item.title, {
        source: item.track.source,
        albumId: item.track.album?.id,
      }),
  },
  {
    id: "artists",
    title: t("stats.topArtists"),
    icon: IconLucideUser,
    circle: true,
    items: artistItems.value,
    onClick: (item) =>
      navigateToArtist(item.title, {
        source: item.track.source,
        artistId: item.artistId,
      }),
  },
]);

/**
 * 紧凑播放次数数字
 * @param plays - 累计播放次数
 * @returns 如 `1.2万`
 */
const playCountText = (plays: number): string => formatCompact(plays, locale.value);

/**
 * 立即播放榜单歌曲
 * @param track - 曲目
 */
const playSong = (track: Track): void => {
  void player.playNow(track);
};
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
    <SCard
      v-for="section in sections"
      :key="section.id"
      radius="xl"
      size="small"
      class="overflow-hidden [&>div:first-child]:py-3 [&>div:last-child]:pb-3"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"
          >
            <component :is="section.icon" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-base font-semibold text-on-surface">
              {{ section.title }}
            </h3>
            <p class="text-xs font-semibold text-on-surface-variant/45">
              TOP {{ loading ? "--" : section.items.length }}
            </p>
          </div>
        </div>
      </template>

      <div v-if="loading" class="flex min-h-56 items-center justify-center">
        <SLoading class="size-6 text-primary/60" />
      </div>

      <div v-else-if="section.items.length > 0">
        <div
          class="grid w-full cursor-pointer grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-primary/8 p-3 text-left transition-colors duration-200 hover:bg-primary/11"
          @click="section.onClick(section.items[0])"
        >
          <div class="shrink-0">
            <SImg
              :src="section.items[0].cover"
              :alt="section.items[0].title"
              class="size-20 ring-1 ring-inset ring-black/10 dark:ring-white/10"
              :class="section.circle ? 'rounded-full' : 'rounded-xl'"
            />
          </div>

          <div class="relative h-20 min-w-0">
            <div class="flex h-full min-w-0 flex-col justify-between py-1.5">
              <div class="min-w-0 pr-12">
                <div class="truncate text-base font-semibold leading-tight text-on-surface">
                  {{ section.items[0].title }}
                </div>
                <div
                  v-if="section.items[0].subtitle"
                  class="mt-1 truncate text-xs leading-none text-on-surface-variant/60"
                >
                  {{ section.items[0].subtitle }}
                </div>
              </div>
              <div class="flex items-baseline gap-1 tabular-nums">
                <span class="text-3xl font-bold leading-none text-on-surface">
                  {{ playCountText(section.items[0].plays) }}
                </span>
                <span class="text-[11px] font-medium text-on-surface-variant/55">
                  {{ t("stats.playsUnit") }}
                </span>
              </div>
            </div>
            <span class="absolute right-0 top-1 text-xs font-bold tracking-wider text-primary">
              TOP 1
            </span>
          </div>
        </div>

        <div class="mt-2 flex flex-col">
          <div
            v-for="(item, index) in section.items.slice(1)"
            :key="`${item.title}-${index}`"
            class="group grid min-h-14 w-full cursor-pointer grid-cols-[1.25rem_2.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl p-1.5 text-left transition-colors duration-200 hover:bg-on-surface/6"
            @click="section.onClick(item)"
          >
            <span
              class="text-center text-xs font-bold text-on-surface-variant/45 tabular-nums transition-colors duration-200 group-hover:text-primary"
            >
              {{ String(index + 2).padStart(2, "0") }}
            </span>
            <SImg
              :src="item.cover"
              :alt="item.title"
              class="size-11 ring-1 ring-inset ring-black/10 dark:ring-white/10"
              :class="section.circle ? 'rounded-full' : 'rounded-lg'"
            />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-on-surface">
                {{ item.title }}
              </div>
              <div v-if="item.subtitle" class="mt-0.5 truncate text-xs text-on-surface-variant/50">
                {{ item.subtitle }}
              </div>
            </div>
            <div class="ml-2 shrink-0 text-right tabular-nums">
              <div class="text-xl font-bold leading-none text-on-surface">
                {{ playCountText(item.plays) }}
              </div>
              <div class="text-[10px] text-on-surface-variant/45">
                {{ t("stats.playsUnit") }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else
        class="flex min-h-56 flex-col items-center justify-center gap-2 rounded-2xl bg-on-surface/3 text-on-surface-variant/40"
      >
        <component :is="section.icon" class="size-7" />
        <span class="text-sm">{{ t("stats.noData") }}</span>
      </div>
    </SCard>
  </div>
</template>
