<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { ContentScope } from "@/types/collection";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { useFavorite } from "@/composables/useFavorite";
import Lyrics from "@/components/player/Lyrics/index.vue";
import PlaylistPickerDialog from "@/components/modals/PlaylistPickerDialog.vue";
import { useWindowControls } from "@/composables/useWindowControls";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import * as player from "@/core/player";
import { formatTime, formatSignedSec } from "@/utils/time";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideListPlus from "~icons/lucide/list-plus";

const { t } = useI18n();
const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const settingsDialog = useSettingsDialog();
const fav = useFavorite();
const {
  isPlaying,
  isLoading,
  position,
  duration,
  isExpanded,
  repeatMode,
  shuffleMode,
  heartMode,
  fmMode,
  showLyric,
} = storeToRefs(status);

/** 歌词组件引用 */
const lyricRef = ref<InstanceType<typeof Lyrics>>();

/** 精确播放时间（毫秒）；offset 直接读 status mirror（主进程权威源） */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs + status.lyricOffsetMs);
  }
});

/** 歌词组件是否已挂载 */
const lyricMounted = ref(false);

/** 展开前：非首次直接恢复渲染 */
const onBeforeEnter = () => {
  if (lyricMounted.value) {
    lyricRef.value?.resume();
    startTick();
  }
};

/** 展开动画结束后：首次挂载歌词组件 */
const onAfterEnter = () => {
  if (!lyricMounted.value) {
    lyricMounted.value = true;
    nextTick(() => {
      lyricRef.value?.resume();
      startTick();
    });
  }
};

/** 收起前：冻结歌词渲染 + 停止时钟 */
const onBeforeLeave = () => {
  lyricRef.value?.freeze();
  stopTick();
};

const hasTrack = computed(() => !!media.track);

/** 当前曲目是否有可显示的歌词 */
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 全屏 */
const { isFullscreen, toggleFullscreen } = useWindowControls();

/** 是否全屏封面 */
const fullscreenCover = computed(() => settings.player.coverLayout === "fullscreen");

/** 封面是否居中 */
const coverCentered = computed(() => {
  if (fullscreenCover.value || status.fullQueueOpen) return false;
  return !showLyric.value || (settings.player.autoCenterCover && !hasLyric.value);
});

/** 弹簧配置 */
const springConfig = computed(() => ({
  mass: settings.lyric.springMass,
  damping: settings.lyric.springDamping,
  stiffness: settings.lyric.springStiffness,
}));

const collapse = (): void => {
  isExpanded.value = false;
};

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};

/** 沉浸模式闲置时间（ms） */
const IMMERSIVE_IDLE_MS = 3000;
/** 沉浸模式是否激活 */
const immersive = ref(false);
/** 鼠标是否悬停在顶栏或底栏 */
const barHovered = ref(false);
/** 闲置定时器 */
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** 沉浸模式是否启用 */
const immersiveEnabled = computed(() => settings.player.autoImmersive && isExpanded.value);

/** 激活沉浸模式 */
const armIdle = (): void => {
  clearTimeout(idleTimer);
  immersive.value = false;
  if (!immersiveEnabled.value) return;
  idleTimer = setTimeout(() => {
    if (!barHovered.value) immersive.value = true;
  }, IMMERSIVE_IDLE_MS);
};

/** 鼠标进入播放器区域 */
const onPlayerMouseEnter = (): void => armIdle();

/** 鼠标离开播放器区域 */
const onPlayerMouseLeave = (): void => {
  clearTimeout(idleTimer);
  if (immersiveEnabled.value) immersive.value = true;
};

/** 鼠标移动 */
const onMainMove = (): void => {
  if (!barHovered.value) armIdle();
};

/** 鼠标进入顶/底栏 */
const onBarEnter = (): void => {
  barHovered.value = true;
  clearTimeout(idleTimer);
  immersive.value = false;
};

/** 鼠标离开顶/底栏 */
const onBarLeave = (): void => {
  barHovered.value = false;
  armIdle();
};

watch(immersiveEnabled, (on) => {
  if (!on) {
    clearTimeout(idleTimer);
    immersive.value = false;
    barHovered.value = false;
  }
});

onBeforeUnmount(() => clearTimeout(idleTimer));

/** 歌词偏移步长（ms） */
const LYRIC_OFFSET_STEP = 500;

/** 偏移弹层是否打开；打开期间按钮组保持可见 */
const offsetPopoverOpen = ref(false);

/** 歌词区右侧操作按钮组的显隐 */
const lyricActionsClass = computed(() => {
  if (immersive.value) return "opacity-0 pointer-events-none";
  if (offsetPopoverOpen.value) return "opacity-100 pointer-events-auto";
  return "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";
});

/** 当前曲目偏移 */
const songOffset = computed(() => status.lyricOffsetMs);

/** 写入偏移 */
const writeOffset = (offsetMs: number): void => {
  const id = media.track?.id;
  if (!id) return;
  window.api.nowPlaying.setLyricOffset(id, offsetMs);
};

/** 弹层里直接编辑（ms） */
const offsetInputMs = computed<number>({
  get: () => songOffset.value,
  set: (val) => writeOffset(val ?? 0),
});

/** 歌词提前 */
const advanceLyric = (): void => writeOffset(songOffset.value + LYRIC_OFFSET_STEP);
/** 歌词延后 */
const delayLyric = (): void => writeOffset(songOffset.value - LYRIC_OFFSET_STEP);
/** 重置歌词偏移 */
const resetLyricOffset = (): void => writeOffset(0);

/** 添加到歌单 */
const pickerOpen = ref(false);
const pickerTracks = shallowRef<Track[]>([]);
const pickerMode = ref<ContentScope>("local");

const openPicker = (): void => {
  const track = media.track;
  if (!track) return;
  pickerTracks.value = [track];
  pickerMode.value = track.source === "netease" ? "online" : "local";
  pickerOpen.value = true;
};

/** 歌词显隐按钮 */
const lyricToggleDisabled = computed(() => !hasLyric.value || fullscreenCover.value);
const lyricToggleActive = computed(
  () =>
    showLyric.value && hasLyric.value && !status.fullQueueOpen && !fullscreenCover.value,
);

/** 切换歌词展示 */
const toggleLyric = (): void => {
  if (status.fullQueueOpen) {
    status.fullQueueOpen = false;
    showLyric.value = true;
  } else {
    showLyric.value = !showLyric.value;
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
      @before-enter="onBeforeEnter"
      @after-enter="onAfterEnter"
      @before-leave="onBeforeLeave"
    >
      <div
        v-show="isExpanded"
        class="fixed inset-0 z-200 bg-surface overflow-hidden text-cover"
        :class="immersive ? 'cursor-none [&_*]:!cursor-none' : ''"
        style="--lp-color: rgb(var(--s-cover))"
        @mouseenter="onPlayerMouseEnter"
        @mouseleave="onPlayerMouseLeave"
      >
        <!-- 背景 -->
        <PlayerBackground />
        <!-- 全屏封面 -->
        <div v-if="fullscreenCover" class="absolute inset-y-0 left-0 w-[60%]">
          <PlayerCover fullscreen />
        </div>
        <!-- 底部频谱 -->
        <BottomSpectrum
          v-if="isExpanded && settings.player.enableSpectrum"
          :show="isPlaying && immersive"
        />
        <!-- 顶/底栏渐变遮罩 -->
        <div
          v-if="fullscreenCover"
          class="cover-mask-top absolute top-0 inset-x-0 h-20 z-5 pointer-events-none transition-opacity duration-400"
          :class="immersive ? 'opacity-0' : 'opacity-100'"
        />
        <div
          v-if="fullscreenCover"
          class="cover-mask-bottom absolute bottom-0 inset-x-0 h-48 z-5 pointer-events-none transition-opacity duration-400"
          :class="immersive ? 'opacity-0' : 'opacity-100'"
        />
        <!-- 顶栏 -->
        <div
          class="absolute top-0 inset-x-0 h-14 z-10 app-drag-region transition-opacity duration-400 flex items-center justify-between px-3"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="app-no-drag flex items-center gap-2">
            <SButton
              type="cover"
              variant="ghost"
              circle
              :size="40"
              :disabled="lyricToggleDisabled"
              :class="lyricToggleActive ? 'opacity-100' : 'opacity-40'"
              @click="toggleLyric"
            >
              <template #icon><IconLucideTextQuote /></template>
            </SButton>
          </div>
          <div class="app-no-drag flex items-center gap-3">
            <SButton type="cover" variant="ghost" circle :size="40" @click="toggleFullscreen">
              <template #icon>
                <IconLucideMinimize v-if="isFullscreen" />
                <IconLucideMaximize v-else />
              </template>
            </SButton>
            <WindowControls cover />
          </div>
        </div>
        <!-- 主区域 -->
        <div class="absolute top-14 inset-x-0 bottom-20" @mousemove="onMainMove">
          <!-- 左侧 -->
          <div
            v-if="!fullscreenCover"
            class="absolute inset-y-0 left-0 w-[45%] flex items-center justify-center px-12 transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :style="coverCentered ? 'transform: translateX(calc(100% * 11 / 18))' : undefined"
          >
            <!-- 封面 + 歌曲信息 -->
            <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[11vh]">
              <Transition name="scale-switch" mode="out-in">
                <div :key="media.track?.id">
                  <PlayerCover />
                  <!-- 歌曲信息 -->
                  <div class="absolute top-full left-0 w-full pt-6">
                    <PlayerData align="left" />
                  </div>
                </div>
              </Transition>
            </div>
          </div>
          <!-- 右侧 -->
          <div
            class="group absolute inset-y-0 right-0 pr-20 flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="[
              fullscreenCover ? 'w-1/2' : 'w-[55%]',
              coverCentered || status.fullQueueOpen
                ? 'opacity-0 pointer-events-none'
                : 'opacity-100',
            ]"
          >
            <!-- 全屏封面 -->
            <div
              v-if="fullscreenCover"
              class="shrink-0 pt-2 pb-6 pl-[calc(1em-0.5rem)]"
              :style="{
                fontSize: settings.lyric.adaptiveFontSize
                  ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
                  : `${settings.lyric.fontSize}px`,
              }"
            >
              <PlayerData align="left" simple />
            </div>
            <div
              class="lyric-area relative flex-1 min-h-0"
              :style="{
                fontSize: settings.lyric.adaptiveFontSize
                  ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
                  : `${settings.lyric.fontSize}px`,
                fontWeight: String(settings.lyric.fontWeight),
                fontFamily: settings.lyric.fontFamily || undefined,
              }"
            >
              <Lyrics
                v-if="lyricMounted && hasLyric"
                ref="lyricRef"
                :lyric-lines="media.parsedLyric"
                :playing="isPlaying"
                :align-position="settings.lyric.alignPosition"
                :word-fade-width="settings.lyric.wordFadeWidth"
                :spring-config="springConfig"
                :inactive-alpha="settings.lyric.inactiveAlpha"
                :hide-passed-lines="settings.lyric.hidePassedLines"
                :enable-blur="settings.lyric.enableBlur"
                :enable-word-highlight="settings.lyric.enableWordHighlight"
                :enable-float-animation="settings.lyric.enableFloatAnimation"
                :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
                :show-translation="settings.lyric.showTranslation"
                :show-romanization="settings.lyric.showRomanization"
                @seek="player.seek($event)"
              />
              <div
                v-else-if="lyricMounted"
                class="w-full h-full flex items-center justify-center text-cover/30"
              >
                暂无歌词
              </div>
            </div>
            <!-- 操作按钮 -->
            <div
              class="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 transition-opacity duration-300"
              :class="lyricActionsClass"
            >
              <SButton
                type="cover"
                variant="ghost"
                circle
                :size="40"
                :disabled="!hasTrack"
                @click="advanceLyric"
              >
                <template #icon><IconLucidePlus /></template>
              </SButton>
              <SPopover
                v-model:open="offsetPopoverOpen"
                trigger="click"
                side="left"
                :side-offset="8"
                cover
              >
                <template #trigger>
                  <div
                    class="inline-flex items-center justify-center gap-0.5 h-6 w-10 rounded-md cursor-pointer border border-solid border-cover/30 bg-cover/8 hover:bg-cover/15 transition-colors tabular-nums"
                    :class="!hasTrack ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''"
                  >
                    <span class="text-xs font-medium text-cover">
                      {{ formatSignedSec(songOffset) }}
                    </span>
                    <span class="text-[10px] text-cover/60">s</span>
                  </div>
                </template>
                <div class="flex flex-col gap-2 w-44">
                  <h4 class="m-0 text-sm font-medium leading-tight text-cover">
                    {{ t("player.lyricOffset.title") }}
                  </h4>
                  <p class="m-0 text-xs text-cover/60">{{ t("player.lyricOffset.hint") }}</p>
                  <SNumberInput
                    v-model="offsetInputMs"
                    :step="100"
                    size="small"
                    unit="ms"
                    placeholder="0"
                    cover
                  />
                  <SButton
                    type="cover"
                    variant="secondary"
                    size="tiny"
                    :disabled="songOffset === 0"
                    @click="resetLyricOffset"
                  >
                    {{ t("common.reset") }}
                  </SButton>
                </div>
              </SPopover>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :size="40"
                :disabled="!hasTrack"
                @click="delayLyric"
              >
                <template #icon><IconLucideMinus /></template>
              </SButton>
              <div class="h-px w-6 bg-cover/25 my-1" />
              <SButton
                type="cover"
                variant="ghost"
                circle
                :size="40"
                @click="settingsDialog.show('lyric')"
              >
                <template #icon><IconLucideSettings2 /></template>
              </SButton>
            </div>
          </div>
          <!-- 播放队列 -->
          <div
            class="absolute inset-y-0 right-0 pl-4 py-6 flex items-center"
            :class="[
              fullscreenCover ? 'w-1/2' : 'w-[55%]',
              status.fullQueueOpen ? '' : 'pointer-events-none',
            ]"
          >
            <Transition
              enter-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              enter-from-class="opacity-0"
              leave-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              leave-to-class="opacity-0"
            >
              <div v-if="status.fullQueueOpen" class="w-full h-full">
                <QueuePanel @close="status.fullQueueOpen = false" />
              </div>
            </Transition>
          </div>
        </div>
        <!-- 底栏 -->
        <div
          class="absolute bottom-0 inset-x-0 h-20 z-10 flex items-center gap-4 px-4 transition-opacity duration-400"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="flex-1 min-w-0 flex items-center justify-start gap-2">
            <SButton type="cover" variant="ghost" size="large" circle @click="collapse">
              <template #icon><IconLucideChevronDown /></template>
            </SButton>
            <SButton
              type="cover"
              variant="ghost"
              size="large"
              circle
              :disabled="!hasTrack"
              @click="fav.toggle(media.track)"
            >
              <template #icon>
                <IconFavorite v-if="fav.isLiked(media.track)" />
                <IconFavoriteOutline v-else />
              </template>
            </SButton>
            <SButton
              v-if="media.track?.source === 'local' || media.track?.source === 'netease'"
              type="cover"
              variant="ghost"
              size="large"
              circle
              @click="openPicker"
            >
              <template #icon><IconLucideListPlus /></template>
            </SButton>
          </div>
          <div class="shrink-0 flex flex-col items-center gap-1 w-[clamp(360px,35%,480px)]">
            <div class="flex items-center gap-3">
              <SButton
                type="cover"
                variant="ghost"
                circle
                @click="
                  fmMode
                    ? player.dislikeFmTrack()
                    : heartMode
                      ? player.exitHeartMode()
                      : player.toggleShuffleMode()
                "
              >
                <template #icon>
                  <IconLucideHeartOff v-if="fmMode" />
                  <IconSpHeartMode v-else-if="heartMode" />
                  <IconLucideShuffle v-else-if="shuffleMode === 'on'" />
                  <IconSpPlayOrder v-else />
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack || fmMode"
                @click="player.prevTrack()"
              >
                <template #icon><IconLucideSkipBack /></template>
              </SButton>
              <SButton
                type="cover"
                variant="secondary"
                size="large"
                circle
                :loading="isLoading"
                :disabled="!hasTrack && !isLoading"
                @click="player.togglePlay()"
              >
                <template #icon>
                  <IconLucidePause v-if="isPlaying" />
                  <IconLucidePlay v-else />
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack"
                @click="player.nextTrack()"
              >
                <template #icon><IconLucideSkipForward /></template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="fmMode"
                :class="fmMode || repeatMode === 'off' ? 'opacity-40' : 'opacity-100'"
                @click="player.cycleRepeatMode()"
              >
                <template #icon>
                  <IconLucideInfinity v-if="fmMode" />
                  <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
                  <IconLucideRepeat v-else />
                </template>
              </SButton>
            </div>
            <div class="flex items-center gap-2 w-full">
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(position) }}
              </span>
              <SSlider
                :model-value="position"
                :min="0"
                :max="duration"
                :step="100"
                :always-show-thumb="false"
                cover
                class="flex-1"
                @drag-end="onSeekDragEnd"
              />
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(duration) }}
              </span>
            </div>
          </div>
          <div class="flex-1 min-w-0 flex items-center justify-end">
            <Toolbar cover />
          </div>
        </div>
      </div>
    </Transition>
    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
  </Teleport>
</template>

<style scoped>
.lyric-area {
  filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.2));
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 75%,
    hsla(0, 0%, 100%, 0.6) 85%,
    hsla(0, 0%, 100%, 0)
  );
}

/* 顶部/底部遮罩：多段非线性 alpha，避免暗色渐变出色阶 */
.cover-mask-top {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}

.cover-mask-bottom {
  background-image: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}
</style>
