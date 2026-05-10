<script setup lang="ts">
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { getQualityLabel, getQualityLevel } from "@/utils/quality";
import { navigateToAlbum } from "@/utils/navigate";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    /** 对齐方式 */
    align?: "center" | "left" | "right";
    /** 简单模式：隐藏标签行和副标题 */
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

/** 歌词来源偏好下拉选项 */
const lyricSourceOptions = computed<SSelectOption[]>(() => [
  { value: "auto", label: t("settings.lyricSourcePreference.auto") },
  { value: "qqmusic", label: t("settings.lyricSourcePreference.qqmusic") },
  { value: "kugou", label: t("settings.lyricSourcePreference.kugou") },
  { value: "netease", label: t("settings.lyricSourcePreference.netease") },
  { value: "self", label: t("settings.lyricSourcePreference.self") },
]);

/** 跳转到专辑页 */
const goToAlbum = () => {
  const track = media.track;
  if (!track?.album?.name) return;
  status.isExpanded = false;
  navigateToAlbum(track.album.name, { source: track.source, albumId: track.album.id });
};

/** 来源标签 */
const sourceLabel = computed(() => {
  switch (media.track?.source) {
    case "online":
      return "ONLINE";
    case "streaming":
      return "STREAMING";
    default:
      return "LOCAL";
  }
});

/** 是否禁用歌词来源切换 */
const lyricSwitchDisabled = computed(() => media.track?.source === "streaming");

/** 音质等级标签 */
const qualityLabel = computed(() => getQualityLabel(media.detail?.quality));

/** 是否为无损级别（显示图标） */
const showLosslessIcon = computed(() => {
  const level = getQualityLevel(media.detail?.quality);
  return level === "hi-res" || level === "lossless";
});

/** 声道描述 */
const channelText = computed(() => {
  const ch = media.detail?.quality?.channels ?? 0;
  if (ch === 2) return t("quality.stereo");
  if (ch === 1) return t("quality.mono");
  return t("quality.multiChannel");
});

/** 歌词格式标签 */
const lyricLabel = computed(() => media.activeLyric?.format.toUpperCase() ?? "NO-LRC");

/** 专辑文本 */
const albumText = computed(() => media.track?.album?.name ?? "");

const alignItems = computed(() => {
  if (props.align === "left") return "items-start";
  if (props.align === "right") return "items-end";
  return "items-center";
});
</script>

<template>
  <div
    v-if="media.track"
    class="w-full flex flex-col gap-[0.5em] overflow-hidden px-2"
    style="font-size: clamp(12px, calc(14 / 1080 * 100vh), 16px)"
    :class="alignItems"
  >
    <!-- 标题 -->
    <div class="max-w-full text-[2em] font-semibold truncate">
      {{ media.track.title }}
    </div>
    <!-- 副标题/注释 -->
    <div
      v-if="!simple && media.track.comment"
      class="max-w-full text-[1.4em] text-cover/40 truncate"
    >
      {{ media.track.comment }}
    </div>
    <!-- 元信息标签行 -->
    <div v-if="!simple" class="flex items-center gap-1.5 text-[1em] my-1 text-cover/60">
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
        <div v-if="media.detail?.quality" class="min-w-48 text-xs">
          <div class="font-medium text-sm mb-2 text-cover">{{ t("quality.details") }}</div>
          <div class="flex flex-col gap-1.5 text-cover/70">
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.codec") }}</span>
              <span>{{ media.detail.quality.codec.toUpperCase() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.sampleRate") }}</span>
              <span>{{ (media.detail.quality.sampleRate / 1000).toFixed(1) }} kHz</span>
            </div>
            <div v-if="media.detail.quality.bitsPerSample > 0" class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.bitDepth") }}</span>
              <span>{{ media.detail.quality.bitsPerSample }} bit</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.bitRate") }}</span>
              <span>{{ Math.round(media.detail.quality.bitRate / 1000) }} kbps</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cover/40">{{ t("quality.channels") }}</span>
              <span>{{ channelText }} · {{ media.detail.quality.channels }}</span>
            </div>
          </div>
        </div>
      </SPopover>
      <SPopselect
        v-model="settings.lyric.lyricSourcePreference"
        :options="lyricSourceOptions"
        :disabled="lyricSwitchDisabled"
        side="top"
        :side-offset="8"
        cover
      >
        <template #trigger>
          <span
            class="inline-flex items-center justify-center leading-none px-1.5 py-1.2 rounded-md border border-solid border-cover/30 transition-colors"
            :class="lyricSwitchDisabled ? 'cursor-default' : 'cursor-pointer hover:border-cover/60'"
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
        <template v-if="media.track.artists.length">
          <template v-for="(artist, index) in media.track.artists" :key="index">
            <span class="cursor-pointer transition-colors hover:text-cover">
              {{ artist.name }}
            </span>
            <span v-if="index < media.track.artists.length - 1">/</span>
          </template>
        </template>
        <span v-else class="opacity-60">{{ t("playlist.unknownArtist") }}</span>
      </span>
    </div>
    <!-- 专辑 -->
    <div v-if="albumText" class="max-w-full flex items-center gap-1.5 text-[1.2em] text-cover/60">
      <IconLucideDisc3 class="shrink-0 translate-y-px text-cover/40" />
      <span class="truncate cursor-pointer transition-colors hover:text-cover" @click="goToAlbum">
        {{ albumText }}
      </span>
    </div>
  </div>
</template>
