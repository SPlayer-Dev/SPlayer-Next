<script setup lang="ts">
import type { Artist } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { navigateToArtist } from "@/utils/navigate";
import { getValidArtists } from "@shared/utils/track";

withDefaults(
  defineProps<{
    /** 紧凑模式 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlayerExpanded, isPlaying } = storeToRefs(status);

/** 当前歌曲中可展示的歌手 */
const artists = computed(() => getValidArtists(media.track?.artists));

/** 主歌词行 */
const mainLines = computed(() => media.parsedLyric.filter((l) => !l.isBG));

/** 当前播放栏歌词 */
const currentBarLyric = computed(() => {
  if (
    !settings.player.showLyricInBar ||
    !isPlaying.value ||
    media.lyricIndex < 0 ||
    !mainLines.value.length
  )
    return null;
  const currentMs = media.parsedLyric[media.lyricIndex]?.startTime ?? 0;
  const line = mainLines.value.findLast((l) => l.startTime <= currentMs) ?? mainLines.value[0];
  const text = line.words.map((w) => w.word).join("");
  return {
    key: `${line.startTime}:${text}`,
    text: line.translatedLyric ? `${text}（${line.translatedLyric}）` : text,
  };
});

/** 歌手是否可跳转：非本地需有真实 id */
const isArtistLinkable = (artist: Artist): boolean => {
  if (!artist.name) return false;
  const source = media.track?.source;
  if (source && source !== "local") return !!artist.id;
  return true;
};
</script>

<template>
  <div class="flex items-center min-w-0" :class="compact ? 'gap-2' : 'gap-3'">
    <!-- 封面 -->
    <div
      class="relative shrink-0 rounded-lg overflow-hidden cursor-pointer group"
      :class="compact ? 'size-10 shadow-sm' : 'size-14'"
      @click="isPlayerExpanded = true"
    >
      <SImg :src="media.track?.cover" class="size-full" />
      <div
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors duration-200"
      >
        <IconLucideChevronUp
          class="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="compact ? 'size-4.5' : 'size-6'"
        />
      </div>
    </div>
    <!-- 歌曲信息 -->
    <Transition name="slide-left" mode="out-in">
      <div v-if="media.track" :key="media.track.id" class="min-w-0 flex-1">
        <div class="flex items-center gap-1 min-w-0">
          <SMarquee
            fit
            class="min-w-0"
            :class="
              compact ? 'font-medium text-sm leading-tight' : 'font-bold text-base leading-snug'
            "
          >
            {{ media.track.title }}
          </SMarquee>
          <slot name="title-trailing" />
        </div>
        <Transition name="slide-up" mode="out-in">
          <div v-if="currentBarLyric" :key="currentBarLyric.key" class="min-w-0">
            <SMarquee
              class="text-on-surface-variant"
              :class="compact ? 'text-xs leading-tight mt-0.5' : 'text-sm mt-1'"
            >
              {{ currentBarLyric.text }}
            </SMarquee>
          </div>
          <div
            v-else
            key="artist"
            class="text-on-surface-variant truncate"
            :class="compact ? 'text-xs leading-tight mt-0.5' : 'text-sm mt-1'"
          >
            <template v-if="artists.length">
              <template v-for="(artist, i) in artists" :key="artist.id ?? i">
                <span
                  :class="
                    isArtistLinkable(artist)
                      ? 'cursor-pointer transition-opacity hover:opacity-70'
                      : ''
                  "
                  @click.stop="
                    isArtistLinkable(artist) &&
                    navigateToArtist(artist.name, {
                      source: media.track?.source,
                      artistId: artist.id,
                    })
                  "
                >
                  {{ artist.name }}
                </span>
                <span v-if="i < artists.length - 1" class="mx-0.5 opacity-50">/</span>
              </template>
            </template>
            <span v-else class="opacity-50">{{ $t("playlist.unknownArtist") }}</span>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>
