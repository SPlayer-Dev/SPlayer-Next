<script setup lang="ts">
import type { Artist, PlaybackContext, Track } from "@shared/types/player";
import type { SongWikiView, WikiSong } from "@/types/songWiki";
import {
  fetchMusicListenData,
  fetchWikiData,
  fetchWikiSong,
  WikiNotFoundError,
} from "@/apis/song/wiki";
import { songsByIds } from "@/apis/song/netease";
import { normalizeSongWiki } from "@/utils/songWiki";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useDownload } from "@/composables/useDownload";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import { formatDate } from "@/utils/time";
import DetailCover from "@/components/collection/DetailCover.vue";
import SongList from "@/components/list/SongList.vue";
import WikiSection from "@/components/songWiki/WikiSection.vue";
import WikiSheets from "@/components/songWiki/WikiSheets.vue";
import * as player from "@/core/player";

const route = useRoute();
const { t } = useI18n();
const id = route.params.id as string;

/** 歌曲头部信息 */
const song = shallowRef<WikiSong | null>(null);
/** 归一化后的百科数据 */
const view = shallowRef<SongWikiView | null>(null);
/** 相似歌曲 */
const similarTracks = shallowRef<Track[]>([]);
const loading = ref(true);
const error = ref("");
/** 请求令牌，丢弃过期的并发响应 */
let requestToken = 0;

const currentTrack = computed(() => song.value?.track ?? null);
const story = computed(() => view.value?.story ?? null);
const basicInfo = computed(() => view.value?.basicInfo ?? []);
const creationInfo = computed(() => view.value?.creationInfo ?? []);
const sheets = computed(() => view.value?.sheets ?? []);
const releaseDate = computed(() => formatDate(song.value?.publishTime));
const achievements = computed(() => [
  ...(view.value?.awards ?? []),
  ...(view.value?.credentials ?? []),
]);
/** 初次相遇的「时段 · 日期」 */
const firstListenText = computed(() => {
  const first = story.value?.firstListen;
  if (!first) return "";
  return [first.period, first.date].filter(Boolean).join(" · ");
});
const hasSections = computed(
  () =>
    !!story.value ||
    basicInfo.value.length > 0 ||
    creationInfo.value.length > 0 ||
    sheets.value.length > 0 ||
    achievements.value.length > 0 ||
    similarTracks.value.length > 0,
);

const playbackContext = computed<PlaybackContext>(() => ({
  originId: "song-wiki",
  originType: "page",
  originName: t("songWiki.title"),
}));

/** 加载百科数据，歌曲详情失败进入页内错误态 */
const load = async (): Promise<void> => {
  const token = ++requestToken;
  loading.value = true;
  error.value = "";
  song.value = null;
  view.value = null;
  similarTracks.value = [];
  try {
    const [detail, results] = await Promise.all([
      fetchWikiSong(id),
      Promise.allSettled([fetchWikiData(id), fetchMusicListenData(id)]),
    ]);
    if (token !== requestToken) return;
    song.value = detail;
    const [wiki, listen] = results;
    view.value = normalizeSongWiki(
      wiki.status === "fulfilled" ? wiki.value : null,
      listen.status === "fulfilled" ? listen.value : null,
    );
    if (view.value.similarIds.length > 0) {
      try {
        const tracks = await songsByIds(view.value.similarIds);
        if (token === requestToken) similarTracks.value = tracks;
      } catch {
        // 相似歌曲失败不影响百科主体
      }
    }
  } catch (err) {
    if (token !== requestToken) return;
    error.value =
      err instanceof WikiNotFoundError ? t("songWiki.notFound") : t("songWiki.loadFailed");
  } finally {
    if (token === requestToken) loading.value = false;
  }
};

onMounted(load);

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();
const { enqueue: enqueueDownload } = useDownload();
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(currentTrack, {
  hideWiki: true,
  playbackContext,
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});

/** 播放当前百科歌曲 */
const handlePlay = (): void => {
  if (song.value) void player.playNow(song.value.track, playbackContext.value);
};

/**
 * 打开歌手详情
 * @param artist - 曲目歌手
 */
const goArtist = (artist: Artist): void => {
  navigateToArtist(artist.name, { source: "netease", artistId: artist.id });
};

/** 打开所属专辑详情 */
const goAlbum = (): void => {
  const album = song.value?.track.album;
  if (album) navigateToAlbum(album.name, { source: "netease", albumId: album.id });
};
</script>

<template>
  <div class="h-full overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto flex max-w-[1400px] flex-col gap-8 px-6 pt-2 pb-24">
      <div
        v-if="loading && !song"
        class="flex flex-col items-center gap-3 py-24 text-on-surface-variant/60"
      >
        <SLoading class="text-2xl text-primary/70" />
        <span class="text-sm">{{ t("common.loading") }}</span>
      </div>

      <div v-else-if="error" class="flex flex-col items-center gap-3 py-24">
        <IconLucideTriangleAlert class="size-8 text-on-surface-variant/50" />
        <span class="text-sm text-on-surface-variant">{{ error }}</span>
        <SButton variant="secondary" @click="load">{{ t("common.retry") }}</SButton>
      </div>

      <template v-else-if="song">
        <header class="flex items-start gap-5">
          <DetailCover
            :src="song.track.cover"
            :alt="song.track.title"
            data-cover-hero
            class="size-40 shrink-0 rounded-xl"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <h1 class="truncate text-3xl font-bold text-on-surface">{{ song.track.title }}</h1>
            <div
              class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-on-surface-variant"
            >
              <template
                v-for="(artist, index) in song.track.artists"
                :key="artist.id ?? artist.name"
              >
                <span v-if="index > 0" class="text-on-surface-variant/40">/</span>
                <button
                  type="button"
                  class="bg-transparent border-none cursor-pointer transition-colors hover:text-primary"
                  @click="goArtist(artist)"
                >
                  {{ artist.name }}
                </button>
              </template>
              <template v-if="song.track.album">
                <span v-if="song.track.artists.length" class="text-on-surface-variant/40">·</span>
                <button
                  type="button"
                  class="bg-transparent border-none cursor-pointer truncate transition-colors hover:text-primary"
                  @click="goAlbum"
                >
                  {{ song.track.album.name }}
                </button>
              </template>
            </div>
            <div v-if="releaseDate" class="text-xs text-on-surface-variant/60">
              {{ t("songWiki.releaseDate") }} · {{ releaseDate }}
            </div>
            <div class="mt-2 flex items-center gap-2">
              <SButton type="primary" variant="secondary" round @click="handlePlay">
                <template #icon><IconLucidePlay /></template>
                {{ t("songWiki.play") }}
              </SButton>
              <SDropdownMenu :items="menuItems" align="start" @select="onMenuSelect">
                <template #trigger>
                  <SButton variant="secondary" circle :aria-label="t('songList.context.more')">
                    <template #icon><IconLucideEllipsis /></template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
          </div>
        </header>

        <WikiSection v-if="story" :title="t('songWiki.sections.story')">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SCard
              v-if="story.firstListen"
              size="small"
              variant="primary"
              class="h-full"
              :title="t('songWiki.story.firstListen')"
            >
              <template #header-extra>
                <span v-if="story.firstListen.season" class="text-xs text-on-surface-variant/60">
                  {{ story.firstListen.season }}
                </span>
              </template>
              <div class="text-sm">{{ firstListenText || "-" }}</div>
              <template #footer>
                <div
                  v-if="story.firstListen.meetDurationDesc"
                  class="text-xs text-on-surface-variant/60"
                >
                  {{ story.firstListen.meetDurationDesc }}
                </div>
              </template>
            </SCard>
            <SCard
              v-if="story.totalPlay"
              size="small"
              variant="primary"
              class="h-full"
              :title="t('songWiki.story.totalPlay')"
            >
              <div class="text-sm">
                {{ t("songWiki.story.totalPlayValue", { count: story.totalPlay.playCount }) }}
              </div>
              <template #footer>
                <div v-if="story.totalPlay.text" class="text-xs text-on-surface-variant/60">
                  {{ story.totalPlay.text }}
                </div>
              </template>
            </SCard>
            <SCard
              v-if="story.likeSong"
              size="small"
              variant="primary"
              class="h-full"
              :title="t('songWiki.story.like')"
            >
              <div class="text-sm">{{ story.likeSong.text || "-" }}</div>
              <template #footer>
                <div v-if="story.likeSong.redDesc" class="text-xs text-on-surface-variant/60">
                  {{ story.likeSong.redDesc }}
                </div>
              </template>
            </SCard>
          </div>
        </WikiSection>

        <WikiSection v-if="basicInfo.length" :title="t('songWiki.sections.basic')">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <SCard
              v-for="item in basicInfo"
              :key="item.label"
              size="small"
              class="h-full"
              :title="item.label"
            >
              <div v-if="item.tags.length" class="flex flex-wrap gap-1.5">
                <STag v-for="tag in item.tags" :key="tag" round size="small">{{ tag }}</STag>
              </div>
              <div v-else class="text-sm">{{ item.text || "-" }}</div>
            </SCard>
          </div>
        </WikiSection>

        <WikiSection v-if="creationInfo.length" :title="t('songWiki.sections.creation')">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <SCard
              v-for="item in creationInfo"
              :key="item.label"
              size="small"
              class="h-full"
              :title="item.label"
            >
              <div class="text-sm text-on-surface-variant">
                {{ item.names.join(" / ") }}
              </div>
            </SCard>
          </div>
        </WikiSection>

        <WikiSection v-if="sheets.length" :title="t('songWiki.sections.sheets')">
          <WikiSheets :sheets="sheets" />
        </WikiSection>

        <WikiSection v-if="achievements.length" :title="t('songWiki.sections.achievements')">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SCard
              v-for="(item, index) in achievements"
              :key="`${item.title}-${index}`"
              size="small"
            >
              <div class="flex items-center gap-3">
                <img
                  v-if="item.image"
                  :src="item.image"
                  loading="lazy"
                  decoding="async"
                  class="size-12 shrink-0 rounded-lg object-cover"
                  alt=""
                />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">{{ item.title }}</div>
                  <div v-if="item.subTitle" class="truncate text-xs text-on-surface-variant/60">
                    {{ item.subTitle }}
                  </div>
                </div>
              </div>
            </SCard>
          </div>
        </WikiSection>

        <WikiSection v-if="similarTracks.length" :title="t('songWiki.sections.similar')">
          <SongList
            :items="similarTracks"
            source="netease"
            :playback-context="playbackContext"
            :show-index="false"
            :enable-sort="false"
            flush
            auto-height
          />
        </WikiSection>

        <div
          v-if="!hasSections && !loading"
          class="py-16 text-center text-sm text-on-surface-variant/60"
        >
          {{ t("songWiki.empty") }}
        </div>
      </template>
    </div>

    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
  </div>
</template>
