<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { TopAlbum, TopArtist, TopTrack } from "@shared/types/stats";
import * as player from "@/core/player";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import { formatCompact } from "@/utils/format";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUser from "~icons/lucide/user";

/** 榜单卡片内的排行项 */
interface RankItem {
  /** 封面 */
  cover?: string;
  /** 标题 */
  title: string;
  /** 累计播放次数 */
  plays: number;
  /** 歌曲：点击封面直接播放 */
  track?: Track;
}

const props = defineProps<{
  /** 最常听的歌曲 */
  songs: TopTrack[];
  /** 最常听的专辑 */
  albums: TopAlbum[];
  /** 最常听的歌手 */
  artists: TopArtist[];
}>();

const { t, locale } = useI18n();

/** 歌曲榜：保留 track 供点击播放 */
const songItems = computed<RankItem[]>(() =>
  props.songs.map((item) => ({
    cover: item.track.cover,
    title: item.track.title,
    plays: item.playCount,
    track: item.track,
  })),
);

/** 专辑榜 */
const albumItems = computed<RankItem[]>(() =>
  props.albums.map((item) => ({ cover: item.cover, title: item.name, plays: item.playCount })),
);

/** 歌手榜 */
const artistItems = computed<RankItem[]>(() =>
  props.artists.map((item) => ({ cover: item.cover, title: item.name, plays: item.playCount })),
);

/** 三个榜单卡片配置：标题 / 封面圆角（歌手圆形）/ 点击行为 / 空态图标 */
const sections = computed(() => [
  {
    id: "songs",
    title: t("stats.topSongs"),
    circle: false,
    items: songItems.value,
    onClick: (item: RankItem) => item.track && playSong(item.track),
    emptyIcon: IconLucideMusic,
  },
  {
    id: "albums",
    title: t("stats.topAlbums"),
    circle: false,
    items: albumItems.value,
    onClick: (item: RankItem) => navigateToAlbum(item.title),
    emptyIcon: IconLucideDisc3,
  },
  {
    id: "artists",
    title: t("stats.topArtists"),
    circle: true,
    items: artistItems.value,
    onClick: (item: RankItem) => navigateToArtist(item.title),
    emptyIcon: IconLucideUser,
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
    <SCard v-for="section in sections" :key="section.id" radius="xl" flush class="overflow-hidden">
      <h3 class="px-5 pt-5 text-lg font-semibold text-on-surface">{{ section.title }}</h3>

      <div v-if="section.items.length > 0" class="flex flex-col px-5 pb-5 pt-3">
        <div
          v-for="(item, index) in section.items"
          :key="item.title"
          class="group flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors duration-200 hover:bg-on-surface/8"
          :class="index === 0 ? 'gap-4 p-3' : ''"
          @click="section.onClick(item)"
        >
          <div class="relative shrink-0">
            <SImg
              :src="item.cover"
              :alt="item.title"
              :class="[
                section.circle ? 'rounded-full' : 'rounded-lg',
                index === 0 ? 'size-20' : 'size-14',
              ]"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div v-if="index === 0" class="text-[10px] font-bold tracking-wider text-primary">
              Top
            </div>
            <div class="leading-none text-on-surface tabular-nums">
              <span class="font-bold" :class="index === 0 ? 'text-3xl' : 'text-xl'">
                {{ playCountText(item.plays) }}
              </span>
              <span class="ml-1 text-xs font-medium text-on-surface-variant/60">
                {{ t("stats.playsUnit") }}
              </span>
            </div>
            <div class="mt-1.5 truncate text-sm text-on-surface">
              {{ item.title }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="section.items.length === 0"
        class="flex flex-col items-center justify-center gap-2 py-12 text-on-surface-variant/40"
      >
        <component :is="section.emptyIcon" class="size-7" />
        <span class="text-sm">{{ t("stats.noData") }}</span>
      </div>
    </SCard>
  </div>
</template>
