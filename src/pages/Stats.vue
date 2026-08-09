<script setup lang="ts">
import type {
  DailyPlayStats,
  LibraryStats,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "@shared/types/stats";

const libraryStats = ref<LibraryStats | null>(null);
const daily = ref<DailyPlayStats[]>([]);
// shallowRef：track 嵌套对象会随 IPC 传入主进程，深代理对象无法被结构化克隆
const topSongs = shallowRef<TopTrack[]>([]);
const topAlbums = shallowRef<TopAlbum[]>([]);
const topArtists = shallowRef<TopArtist[]>([]);

onMounted(async () => {
  const [library, history, songs, albums, artists] = await Promise.all([
    window.api.stats.getLibraryStats(),
    window.api.stats.getPlayHistoryDaily(90),
    window.api.stats.getTopTracks(10),
    window.api.stats.getTopAlbums(10),
    window.api.stats.getTopArtists(10),
  ]);
  libraryStats.value = library;
  daily.value = history;
  topSongs.value = songs;
  topAlbums.value = albums;
  topArtists.value = artists;
});
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-2 pb-10">
      <!-- 曲库概览 -->
      <StatsOverview :stats="libraryStats" />
      <!-- 每日播放热力图 + 格式分布 -->
      <StatsHeatmap :daily="daily" :stats="libraryStats" />
      <!-- 最常听榜单 -->
      <StatsTopList :songs="topSongs" :albums="topAlbums" :artists="topArtists" />
    </div>
  </div>
</template>
