<script setup lang="ts">
import type { Artist } from "@shared/types/player";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { getQualityLabel, getQualityLevel } from "@/utils/quality";
import {
  canNavigateToResource,
  navigateToResource,
  type ResourceNavigationTarget,
} from "@/utils/navigate";
import { getValidArtists } from "@shared/utils/track";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    /** 对齐方式 */
    align?: "center" | "left" | "right";
    /** 简单模式 */
    simple?: boolean;
  }>(),
  {
    align: "center",
    simple: false,
  },
);

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 加载中的歌曲 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const artists = computed(() => getValidArtists(displayTrack.value?.artists));

/** 歌词来源偏好下拉选项 */
const lyricSourceOptions = computed<SSelectOption[]>(() => [
  { value: "auto", label: t("settings.lyricSourcePreference.auto") },
  { value: "qqmusic", label: t("settings.lyricSourcePreference.qqmusic") },
  { value: "kugou", label: t("settings.lyricSourcePreference.kugou") },
  { value: "netease", label: t("settings.lyricSourcePreference.netease") },
  { value: "self", label: t("settings.lyricSourcePreference.self") },
]);

/** 生成歌手详情页跳转目标 */
const artistTarget = (artist: Artist): ResourceNavigationTarget => ({
  type: "artist",
  source: displayTrack.value?.source,
  id: artist.id,
  name: artist.name,
});

/** 歌手是否可跳转 */
const isArtistLinkable = (artist: Artist): boolean => canNavigateToResource(artistTarget(artist));

/** 当前专辑详情页跳转目标 */
const albumTarget = computed<ResourceNavigationTarget | null>(() => {
  const track = displayTrack.value;
  if (!track?.album?.name) return null;
  return {
    type: "album",
    source: track.source,
    id: track.album.id,
    name: track.album.name,
  };
});

/** 专辑是否可跳转 */
const isAlbumLinkable = computed(() =>
  albumTarget.value ? canNavigateToResource(albumTarget.value) : false,
);

/** 跳转成功后收起全屏播放器 */
const goToResource = (target: ResourceNavigationTarget | null): void => {
  if (target && navigateToResource(target)) status.isPlayerExpanded = false;
};

/** 来源标签 */
const sourceLabel = computed(() => {
  if (displayTrack.value?.cloud) return "CLOUD";
  const source = displayTrack.value?.source;
  if (!source) return "LOCAL";
  if (source === "local") return "LOCAL";
  if (source === "streaming") return "STREAMING";
  return source.toUpperCase();
});

/** 音质等级标签 */
const quality = computed(() => media.detail?.quality ?? displayTrack.value?.quality);
const qualityLabel = computed(() => getQualityLabel(quality.value));

/** 是否为无损级别（显示图标） */
const showLosslessIcon = computed(() => {
  const level = getQualityLevel(quality.value);
  return level === "hi-res" || level === "lossless";
});

/** 声道描述 */
const channelText = computed(() => {
  const ch = quality.value?.channels ?? 0;
  if (ch === 2) return t("quality.stereo");
  if (ch === 1) return t("quality.mono");
  return t("quality.multiChannel");
});

/** 歌词格式标签 */
const lyricLabel = computed(() => media.activeLyric?.format.toUpperCase() ?? "NO-LRC");

/** 专辑文本 */
const albumText = computed(() => displayTrack.value?.album?.name ?? "");

/** 当前实际加载歌曲的播放来源 */
const playbackSource = computed(() => media.playbackContext);
const playbackSourceTarget = computed<ResourceNavigationTarget | null>(() => {
  const context = playbackSource.value;
  const name = context?.originName?.trim();
  if (!context || !name || context.originType === "track") return null;
  if (context.originType === "page") {
    return { type: "page", id: context.originId, name };
  }
  if (!context.provider) return null;
  return {
    type: context.originType,
    source: context.provider,
    id: context.originId,
    name,
  };
});
const playbackSourceText = computed(() => playbackSourceTarget.value?.name ?? "");
const isPlaybackSourceLinkable = computed(() =>
  playbackSourceTarget.value ? canNavigateToResource(playbackSourceTarget.value) : false,
);

const alignItems = computed(() => {
  if (props.align === "left") return "items-start";
  if (props.align === "right") return "items-end";
  return "items-center";
});
</script>

<template>
  <div
    v-if="displayTrack"
    class="w-full flex flex-col gap-[0.5em] overflow-hidden px-2"
    style="font-size: clamp(12px, calc(14 / 1080 * 100vh), 16px)"
    :class="alignItems"
  >
    <!-- 标题 -->
    <div class="max-w-full text-[2em] font-semibold truncate">
      {{ displayTrack.title }}
    </div>
    <!-- 副标题/注释 -->
    <div
      v-if="!simple && displayTrack.comment"
      class="max-w-full text-[1.4em] text-cover/40 truncate"
    >
      {{ displayTrack.comment }}
    </div>
    <!-- 元信息标签行 -->
    <div class="flex items-center gap-1.5 text-[1em] my-1 text-cover/60">
      <span
        class="inline-flex items-center justify-center leading-none px-1.5 py-1.2 rounded-md border border-solid border-cover/30"
      >
        {{ sourceLabel }}
      </span>
      <SPopover side="top" :side-offset="8" cover trigger="hover">
        <template #trigger>
          <span
            class="inline-flex items-center gap-1 leading-none px-1.5 py-1.2 rounded-md border border-solid border-cover/30 cursor-pointer transition-colors hover:border-cover/60"
          >
            <IconSpLossless v-if="showLosslessIcon" class="text-[1.4em] -my-[0.4em]" />
            {{ qualityLabel }}
          </span>
        </template>
        <div v-if="quality" class="min-w-48 text-xs">
          <div class="font-medium text-sm mb-2 text-cover">{{ t("quality.details") }}</div>
          <div class="flex flex-col gap-1.5 text-cover/70">
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.codec") }}</span>
              <span>{{ quality.codec.toUpperCase() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.sampleRate") }}</span>
              <span>{{ (quality.sampleRate / 1000).toFixed(1) }} kHz</span>
            </div>
            <div v-if="quality.bitsPerSample > 0" class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.bitDepth") }}</span>
              <span>{{ quality.bitsPerSample }} bit</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.bitRate") }}</span>
              <span>{{ Math.round(quality.bitRate / 1000) }} kbps</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.channels") }}</span>
              <span>{{ channelText }} · {{ quality.channels }}</span>
            </div>
          </div>
        </div>
      </SPopover>
      <SPopselect
        v-model="settings.lyric.lyricSourcePreference"
        :options="lyricSourceOptions"
        side="top"
        :side-offset="8"
        cover
      >
        <template #trigger>
          <span
            class="inline-flex items-center justify-center leading-none px-1.5 py-1.2 rounded-md border border-solid border-cover/30 cursor-pointer transition-colors hover:border-cover/60"
          >
            {{ lyricLabel }}
          </span>
        </template>
      </SPopselect>
    </div>
    <!-- 歌手 -->
    <div class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60">
      <IconLucideMic class="shrink-0 translate-y-px text-cover/40" />
      <span class="truncate">
        <template v-if="artists.length">
          <template v-for="(artist, index) in artists" :key="artist.id ?? index">
            <span
              :class="
                isArtistLinkable(artist) ? 'cursor-pointer transition-colors hover:text-cover' : ''
              "
              @click="goToResource(artistTarget(artist))"
            >
              {{ artist.name }}
            </span>
            <span v-if="index < artists.length - 1" class="mx-0.5 opacity-50">/</span>
          </template>
        </template>
        <span v-else class="opacity-50">{{ t("playlist.unknownArtist") }}</span>
      </span>
    </div>
    <!-- 专辑 -->
    <div v-if="albumText" class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60">
      <IconLucideDisc3 class="shrink-0 translate-y-px text-cover/40" />
      <span
        class="truncate"
        :class="isAlbumLinkable ? 'cursor-pointer transition-colors hover:text-cover' : ''"
        @click="goToResource(albumTarget)"
      >
        {{ albumText }}
      </span>
    </div>
    <!-- 播放来源 -->
    <div
      v-if="!simple && settings.player.showPlaybackSource && playbackSourceText"
      class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60"
    >
      <IconLucideLink2 class="shrink-0 translate-y-px text-cover/40" />
      <span
        class="truncate"
        :class="isPlaybackSourceLinkable ? 'cursor-pointer transition-colors hover:text-cover' : ''"
        @click="goToResource(playbackSourceTarget)"
      >
        {{ playbackSourceText }}
      </span>
    </div>
  </div>
</template>
