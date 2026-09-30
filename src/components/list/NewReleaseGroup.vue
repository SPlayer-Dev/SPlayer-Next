<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { FollowedArtistNewWork } from "@/apis/recommend/netease";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";

const props = defineProps<{
  work: FollowedArtistNewWork;
}>();

const { t, locale } = useI18n();
const expanded = ref(false);
const PREVIEW_TRACK_COUNT = 3;

const visibleTracks = computed(() =>
  expanded.value ? props.work.tracks : props.work.tracks.slice(0, PREVIEW_TRACK_COUNT),
);

const remainingCount = computed(() => props.work.tracks.length - PREVIEW_TRACK_COUNT);
const singleTrack = computed(() =>
  props.work.tracks.length === 1 ? props.work.tracks[0] : undefined,
);

const releaseDate = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: "long", day: "numeric" }).format(
    new Date(props.work.publishTime),
  ),
);

const releaseText = computed(() =>
  t(props.work.blockType === "album" ? "newReleases.releaseAlbum" : "newReleases.releaseSong", {
    date: releaseDate.value,
  }),
);

const artistNames = (track: Track): string =>
  track.artists.map((artist) => artist.name).join(" / ");

const openArtist = (): void => {
  navigateToArtist(props.work.artistName, {
    source: "netease",
    artistId: props.work.artistId,
  });
};

const openResource = (): void => {
  if (props.work.blockType === "album") {
    navigateToAlbum(props.work.resourceName, {
      source: "netease",
      albumId: props.work.resourceId,
    });
    return;
  }
  const track = props.work.tracks[0];
  if (track) void player.playNow(track);
};

const playWork = (): void => {
  if (props.work.tracks.length > 0) void player.playFrom(props.work.tracks, 0);
};

const playTrack = (track: Track): void => {
  void player.playNow(track);
};

watch(
  () => props.work.id,
  () => {
    expanded.value = false;
  },
);
</script>

<template>
  <article
    class="flex gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-4 transition-colors hover:border-outline-variant/30"
  >
    <button
      class="m-0 size-10 shrink-0 appearance-none overflow-hidden rounded-full border-0 bg-transparent p-0 outline-none ring-primary/35 transition-shadow focus-visible:ring-2"
      type="button"
      @click="openArtist"
    >
      <SImg :src="work.artistAvatar" :alt="work.artistName" class="size-full" />
    </button>

    <div class="min-w-0 flex-1">
      <div class="mb-2 flex min-w-0 items-baseline gap-1.5 text-sm">
        <button
          type="button"
          class="m-0 max-w-52 appearance-none truncate border-0 bg-transparent p-0 font-medium text-primary outline-none hover:underline focus-visible:underline"
          @click="openArtist"
        >
          {{ work.artistName }}
        </button>
        <span class="shrink-0 text-on-surface-variant/65">{{ releaseText }}</span>
      </div>

      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="group relative m-0 size-16 shrink-0 appearance-none overflow-hidden rounded-lg border-0 bg-transparent p-0 outline-none ring-primary/35 focus-visible:ring-2"
          :title="t('newReleases.playRelease')"
          @click="playWork"
        >
          <SImg
            :src="work.resourceCover ?? work.tracks[0]?.cover"
            :fallback="work.tracks[0]?.cover"
            :alt="work.resourceName"
            class="size-full"
          />
          <span
            class="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/30 group-focus-visible:bg-black/30"
          >
            <span
              class="flex size-6 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm ring-1 ring-white/85 transition-transform group-hover:scale-105"
            >
              <IconLucidePlay class="size-3.5 fill-current" />
            </span>
          </span>
        </button>
        <button
          type="button"
          class="m-0 min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-left outline-none"
          @click="openResource"
        >
          <span class="block truncate text-base font-medium text-on-surface hover:text-primary">
            {{ work.resourceName }}
          </span>
          <span class="mt-1 block truncate text-xs text-on-surface-variant/55">
            {{ work.artistName }}
            <template v-if="work.blockType === 'album'">
              · {{ t("newReleases.trackCount", { count: work.albumSongCount }) }}
            </template>
          </span>
        </button>
        <span
          v-if="singleTrack"
          class="mr-2 w-12 shrink-0 text-right text-xs tabular-nums text-on-surface-variant/45"
        >
          {{ formatTime(singleTrack.duration) }}
        </span>
      </div>

      <div v-if="work.tracks.length > 1" class="mt-3 border-t border-outline-variant/12 pt-2">
        <button
          v-for="(track, index) in visibleTracks"
          :key="track.id"
          type="button"
          class="group m-0 flex h-12 w-full appearance-none items-center gap-3 rounded-lg border-0 bg-transparent px-2 text-left outline-none transition-colors hover:bg-on-surface/5 focus-visible:bg-on-surface/5"
          @click="playTrack(track)"
        >
          <span class="w-6 shrink-0 text-center text-xs tabular-nums text-on-surface-variant/45">
            {{ index + 1 }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-on-surface group-hover:text-primary">
              {{ track.title }}
            </span>
            <span class="mt-0.5 block truncate text-xs text-on-surface-variant/50">
              {{ artistNames(track) }}
            </span>
          </span>
          <span class="w-12 shrink-0 text-right text-xs tabular-nums text-on-surface-variant/45">
            {{ formatTime(track.duration) }}
          </span>
        </button>

        <SButton
          v-if="remainingCount > 0"
          variant="text"
          size="small"
          class="ml-9 mt-1"
          @click="expanded = !expanded"
        >
          {{
            expanded
              ? t("newReleases.collapse")
              : t("newReleases.expand", { count: remainingCount })
          }}
          <template #icon>
            <IconLucideChevronDown
              class="size-3.5 transition-transform"
              :class="expanded && 'rotate-180'"
            />
          </template>
        </SButton>
      </div>
    </div>
  </article>
</template>
