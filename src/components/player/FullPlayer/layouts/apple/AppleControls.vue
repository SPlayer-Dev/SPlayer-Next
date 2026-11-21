<script setup lang="ts">
import type { Artist } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useFavorite } from "@/composables/useFavorite";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { useProgressLyric } from "@/composables/useProgressLyric";
import { useFullPlayer } from "../../context";
import * as player from "@/core/player";
import { volumeGainToPosition, volumePositionToGain } from "@/utils/volume";
import { getValidArtists } from "@shared/utils/track";
import { getQualityLabel, isLosslessQuality } from "@/utils/quality";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useDownload } from "@/composables/useDownload";
import { useTrackMenu } from "@/composables/useTrackMenu";
import {
  canNavigateToResource,
  navigateToResource,
  type ResourceNavigationTarget,
} from "@/utils/navigate";
import { setPlayerExpanded } from "@/services/playerTransition";
import "./amllMediaButton.css";

const { t } = useI18n();
const status = useStatusStore();
const media = useMediaStore();
const fav = useFavorite();
const { isPlaying, isLoading, duration, repeatMode, shuffleMode, heartMode, fmMode } =
  storeToRefs(status);
const { timeDisplay, toggleTimeFormat } = useTimeFormat();
const { snapToNearestLyric } = useProgressLyric();

/** 加载中的歌曲使用队列当前项兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const hasTrack = computed(() => !!displayTrack.value);

const artists = computed(() => getValidArtists(displayTrack.value?.artists));

/**
 * 生成歌手详情页跳转目标
 * @param artist - 当前歌曲的歌手
 * @returns 携带服务器身份的详情页目标
 */
const artistTarget = (artist: Artist): ResourceNavigationTarget => ({
  type: "artist",
  source: displayTrack.value?.source,
  serverId: displayTrack.value?.serverId,
  id: artist.id,
  name: artist.name,
});

/**
 * 跳转歌手详情页并收起全屏播放器
 * @param artist - 当前歌曲的歌手
 */
const goToArtist = (artist: Artist): void => {
  if (navigateToResource(artistTarget(artist))) setPlayerExpanded(false);
};

const quality = computed(() => media.detail?.quality ?? displayTrack.value?.quality);

const volumePosition = computed(() => volumeGainToPosition(status.volume));

const onSeekDragEnd = (value: number): void => {
  player.seek(snapToNearestLyric(value));
};

/** 展开且可见时才允许进度条自走 */
const { contentActive } = useFullPlayer();

/** 跳曲箭头动画的重放计数，点击时重新播放箭头滑动效果 */
const rewindTick = ref(0);
const forwardTick = ref(0);

/** 上一首并重播箭头动画 */
const prevTrack = (): void => {
  rewindTick.value++;
  player.prevTrack();
};

/** 下一首并重播箭头动画 */
const nextTrack = (): void => {
  forwardTick.value++;
  player.nextTrack();
};

/**
 * 随机播放/循环播放按压缩放标记
 *
 * 移植自 @applemusic-like-lyrics/react-full 的 MediaButton（AGPL-3.0）：点击加类触发一次
 * 0.7s 回弹动画，animationend 后清除；动画进行中再次点击不重放
 */
const shufflePressed = ref(false);
/** 循环播放按压缩放标记（同 shufflePressed） */
const repeatPressed = ref(false);

/** 按压缩放并切换随机模式 */
const onShuffleClick = (): void => {
  shufflePressed.value = true;
  if (fmMode.value) player.dislikeFmTrack();
  else if (heartMode.value) player.exitHeartMode();
  else player.toggleShuffleMode();
};

/** 按压缩放并切换循环模式 */
const onRepeatClick = (): void => {
  repeatPressed.value = true;
  player.cycleRepeatMode();
};

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

const { enqueue: enqueueDownload } = useDownload();
const { items: menuItems, handleSelect: onMenuSelect } = useTrackMenu(toRef(media, "track"), {
  hidePlayActions: true,
  onAddToPlaylist: (track) => openPicker([track]),
  onDownload: (track, quality) => void enqueueDownload(track, { quality }),
});
</script>

<template>
  <div class="w-full flex flex-col gap-[1.6vh] text-[max(2vh,14px)]">
    <!-- 标题与歌手 -->
    <div class="flex items-center gap-3 leading-[1.25em]">
      <div class="flex-1 min-w-0">
        <SMarquee fit class="max-w-full font-semibold tracking-[0.2px] text-cover/95">
          {{ displayTrack?.title }}
        </SMarquee>
        <div class="truncate tracking-[0.2px] text-cover/50">
          <template v-if="artists.length">
            <template v-for="(artist, index) in artists" :key="artist.id ?? index">
              <span
                :class="
                  canNavigateToResource(artistTarget(artist))
                    ? 'cursor-pointer transition-colors hover:text-cover/80'
                    : ''
                "
                @click="goToArtist(artist)"
              >
                {{ artist.name }}
              </span>
              <template v-if="index < artists.length - 1">{{ ", " }}</template>
            </template>
          </template>
          <template v-else>{{ t("playlist.unknownArtist") }}</template>
        </div>
      </div>
      <SButton
        v-if="displayTrack?.source !== 'plugin'"
        type="cover"
        variant="secondary"
        circle
        :size="32"
        :disabled="!hasTrack || !fav.isSupported(displayTrack)"
        @click="fav.toggle(displayTrack)"
      >
        <template #icon>
          <SIconSwap :active="fav.isLiked(displayTrack)">
            <template #on><IconSpAmStarFilled /></template>
            <template #off><IconSpAmStar /></template>
          </SIconSwap>
        </template>
      </SButton>
      <SDropdownMenu
        v-if="media.track"
        :items="menuItems"
        cover
        side="top"
        align="end"
        @select="onMenuSelect"
      >
        <template #trigger>
          <SButton type="cover" variant="secondary" circle :size="32">
            <template #icon><IconLucideEllipsis /></template>
          </SButton>
        </template>
      </SDropdownMenu>
    </div>
    <!-- 进度与音质 -->
    <div>
      <AppleSlider
        :model-value="status.position"
        :min="0"
        :max="duration"
        :playing="isPlaying"
        :active="contentActive"
        :glow="status.transitioning"
        @change="onSeekDragEnd"
      />
      <div
        class="mt-1.5 h-[1.5em] grid grid-cols-[1fr_auto_1fr] items-center text-[max(1.5vh,13px)] font-medium tabular-nums"
      >
        <span class="text-cover/50 cursor-pointer select-none" @click="toggleTimeFormat">
          {{ timeDisplay[0] }}
        </span>
        <span
          v-if="quality || status.transitioning"
          class="inline-grid place-items-center overflow-hidden px-1.5 py-0.5 rounded-[4px] text-[max(1.5vh,13px)] leading-none text-cover/80 transition-colors duration-200"
          :class="status.transitioning ? 'cursor-default' : 'cursor-pointer bg-cover/15'"
          @click="!status.transitioning && (status.audioInfoOpen = true)"
        >
          <span
            class="[grid-area:1/1] flex items-center gap-1 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            :class="status.transitioning ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'"
            :aria-hidden="status.transitioning"
          >
            <template v-if="quality">
              <IconSpLossless v-if="isLosslessQuality(quality)" class="text-[1.2em]" />
              {{ getQualityLabel(quality) }}
            </template>
          </span>
          <Transition
            enter-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            leave-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            enter-from-class="opacity-0 translate-y-1"
            leave-to-class="opacity-0 translate-y-1"
          >
            <span
              v-if="status.transitioning"
              class="apple-transition-shine [grid-area:1/1] whitespace-nowrap"
              role="status"
            >
              {{
                status.transitionMode === "automix"
                  ? t("player.automixing")
                  : t("player.transitioning")
              }}
            </span>
          </Transition>
        </span>
        <span v-else />
        <span class="text-right text-cover/50 cursor-pointer select-none" @click="toggleTimeFormat">
          {{ timeDisplay[1] }}
        </span>
      </div>
    </div>
    <!-- 播放控制 -->
    <div class="flex items-center justify-between text-cover">
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        :class="['w-[18%] aspect-square amll-media-btn', shufflePressed ? 'amll-pressed' : '']"
        @click="onShuffleClick"
        @animationend="shufflePressed = false"
      >
        <IconLucideHeartOff v-if="fmMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpHeartMode v-else-if="heartMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpAmShuffleActive
          v-else-if="shuffleMode === 'on'"
          class="size-[clamp(22px,2.9vh,40px)]"
        />
        <IconSpAmShuffle v-else class="size-[clamp(22px,2.9vh,40px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack || fmMode"
        @click="prevTrack"
      >
        <IconSpAmRewind :key="rewindTick" class="size-[clamp(40px,6.4vh,80px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack && !isLoading"
        @click="player.togglePlay()"
      >
        <SLoading v-if="isLoading" class="size-[clamp(28px,3.9vh,52px)]" />
        <SIconSwap v-else :active="isPlaying" class="size-[clamp(28px,3.9vh,52px)]">
          <template #on><IconSpAmPause /></template>
          <template #off><IconSpAmPlay /></template>
        </SIconSwap>
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        class="w-[18%] aspect-square"
        :disabled="!hasTrack"
        @click="nextTrack"
      >
        <IconSpAmForward :key="forwardTick" class="size-[clamp(40px,6.4vh,80px)]" />
      </SButton>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="auto"
        :class="['w-[18%] aspect-square amll-media-btn', repeatPressed ? 'amll-pressed' : '']"
        :disabled="fmMode"
        @click="onRepeatClick"
        @animationend="repeatPressed = false"
      >
        <IconLucideInfinity v-if="fmMode" class="size-[clamp(18px,2.4vh,30px)]" />
        <IconSpAmRepeatOne v-else-if="repeatMode === 'one'" class="size-[clamp(22px,2.9vh,40px)]" />
        <IconSpAmRepeatActive v-else class="size-[clamp(22px,2.9vh,40px)]" />
      </SButton>
    </div>
    <!-- 音量 -->
    <div class="flex items-center gap-1.5 text-cover/45">
      <IconSpAmSpeaker class="shrink-0 w-7 h-9" />
      <AppleSlider
        :model-value="volumePosition"
        :min="0"
        :max="1"
        change-on-drag
        class="flex-1"
        @change="player.setVolume(volumePositionToGain($event))"
      />
      <IconSpAmSpeakerMax class="shrink-0 w-9 h-9" />
    </div>
  </div>
  <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
</template>

<style scoped>
/* 动态跳曲箭头 */
:deep(.amll-rewind-right-arrow) {
  animation: 0.6s cubic-bezier(0.4, 1.51, 0.4, 1) forwards amll-rewind-right-end;
}

:deep(.amll-rewind-left-arrow) {
  transform-origin: 19%;
  animation: 0.2s ease-out forwards amll-rewind-left-end;
}

:deep(.amll-rewind-right-standby) {
  transform-origin: 78%;
  animation: 0.6s cubic-bezier(0.4, 1.51, 0.4, 1) forwards amll-rewind-right-new;
}

@keyframes amll-rewind-right-end {
  100% {
    transform: translateX(-40px);
  }
}

@keyframes amll-rewind-left-end {
  100% {
    opacity: 0;
    transform: scale(0);
  }
}

@keyframes amll-rewind-right-new {
  0% {
    opacity: 0;
    transform: scale(0) translateX(15px);
  }

  100% {
    opacity: 1;
    transform: scale(1) translateX(0);
  }
}

:deep(.amll-forward-left-arrow) {
  animation: 0.6s cubic-bezier(0.4, 1.51, 0.4, 1) forwards amll-forward-left-end;
}

:deep(.amll-forward-right-arrow) {
  transform-origin: 81%;
  animation: 0.2s ease-out forwards amll-forward-right-end;
}

:deep(.amll-forward-left-standby) {
  transform-origin: 22%;
  animation: 0.6s cubic-bezier(0.4, 1.51, 0.4, 1) forwards amll-forward-left-new;
}

@keyframes amll-forward-left-end {
  100% {
    transform: translateX(40px);
  }
}

@keyframes amll-forward-right-end {
  100% {
    opacity: 0;
    transform: scale(0);
  }
}

@keyframes amll-forward-left-new {
  0% {
    opacity: 0;
    transform: scale(0) translateX(-15px);
  }

  100% {
    opacity: 1;
    transform: scale(1) translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  :deep(.amll-rewind-right-arrow),
  :deep(.amll-rewind-left-arrow),
  :deep(.amll-rewind-right-standby),
  :deep(.amll-forward-left-arrow),
  :deep(.amll-forward-right-arrow),
  :deep(.amll-forward-left-standby) {
    animation: none;
  }
}

.apple-transition-shine {
  color: transparent;
  background: linear-gradient(
    100deg,
    rgb(var(--s-cover) / 0.6) 40%,
    rgb(var(--s-cover)) 50%,
    rgb(var(--s-cover) / 0.6) 60%
  );
  background-size: 200% 100%;
  background-clip: text;
  animation: apple-transition-shine 1.4s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    background: none;
    color: rgb(var(--s-cover));
  }
}

@keyframes apple-transition-shine {
  from {
    background-position: 100% center;
  }
  to {
    background-position: -100% center;
  }
}
</style>
