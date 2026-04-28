<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import EffectsLyrics from "@/components/player/EffectsLyrics/index.vue";
import SimpleLyrics from "@/components/player/SimpleLyrics/index.vue";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlaying, isLoading, position, duration, isExpanded, repeatMode, shuffleMode } =
  storeToRefs(status);

/** 歌词渲染模式 */
const lyricMode = computed(() => settings.lyric.lyricMode);

/** 歌词组件引用 */
const lyricRef = ref<InstanceType<typeof EffectsLyrics> | InstanceType<typeof SimpleLyrics>>();

/** 精确播放时间（毫秒） */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs);
  }
});

/** 歌词组件是否已挂载 */
const lyricMounted = ref(false);

/** 展开前：非首次直接恢复渲染 */
const onBeforeEnter = () => {
  if (lyricMounted.value) {
    // 非首次展开：组件已常驻，直接恢复
    lyricRef.value?.resume();
    startTick();
  }
};

/** 展开动画结束后：首次挂载歌词组件 */
const onAfterEnter = () => {
  if (!lyricMounted.value) {
    // 首次展开：动画结束后再挂载，避免阻塞展开动画
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

/** 无歌词时居中封面 */
const coverCentered = computed(
  () => settings.player.autoCenterCover && !media.lyricLoading && media.parsedLyric.length === 0,
);

/** 弹簧配置（从 store 三个独立值合成） */
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
        style="
          --lp-color: rgb(var(--s-cover));
          --s-slider-track-bg: rgb(var(--s-cover) / 0.25);
          --s-slider-fill-bg: rgb(var(--s-cover));
          --s-slider-thumb-bg: rgb(var(--s-cover));
        "
      >
        <!-- 背景 -->
        <PlayerBackground />
        <!-- 底部频谱 -->
        <BottomSpectrum v-if="isExpanded && settings.player.enableSpectrum" :show="isPlaying" />
        <!-- 左侧：封面 + 歌曲信息 -->
        <div
          class="absolute top-14 left-0 bottom-20 w-[45%] flex items-center justify-center px-12 transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :style="coverCentered ? 'transform: translateX(calc(100% * 11 / 18))' : undefined"
        >
          <!-- 封面 + 歌曲信息：切歌时整体左右淡入淡出 -->
          <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[11vh]">
            <Transition name="scale-switch" mode="out-in">
              <div :key="media.track?.id">
                <PlayerCover />
                <!-- 歌曲信息（绝对定位，不影响封面居中位置） -->
                <div class="absolute top-full left-0 w-full pt-6">
                  <PlayerData align="left" />
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 右侧：歌词区域 -->
        <div
          class="lyric-area absolute top-14 right-0 bottom-20 pr-20 w-[55%] transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :class="coverCentered ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          :style="{
            fontSize: settings.lyric.adaptiveFontSize
              ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
              : `${settings.lyric.fontSize}px`,
            fontWeight: String(settings.lyric.fontWeight),
          }"
        >
          <EffectsLyrics
            v-if="
              lyricMounted &&
              lyricMode === 'effects' &&
              (media.parsedLyric.length > 0 || media.lyricLoading)
            "
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
          <SimpleLyrics
            v-else-if="
              lyricMounted &&
              lyricMode === 'simple' &&
              (media.parsedLyric.length > 0 || media.lyricLoading)
            "
            ref="lyricRef"
            :lyric-lines="media.parsedLyric"
            :playing="isPlaying"
            @seek="player.seek($event)"
          />
          <div
            v-else-if="lyricMounted && !media.lyricLoading"
            class="w-full h-full flex items-center justify-center text-cover/30"
          >
            暂无歌词
          </div>
        </div>
        <div class="absolute bottom-0 left-0 right-0 h-20 grid grid-cols-3 items-center px-4">
          <!-- 左侧 -->
          <div class="flex items-center shrink-0">
            <SButton type="cover" variant="ghost" size="large" circle @click="collapse">
              <template #icon><IconLucideChevronDown /></template>
            </SButton>
          </div>

          <div class="flex flex-col items-center gap-1">
            <div class="flex items-center gap-3">
              <SButton
                type="cover"
                variant="ghost"
                circle
                :class="shuffleMode === 'on' ? 'opacity-100' : 'opacity-40'"
                @click="player.toggleShuffleMode()"
              >
                <template #icon><IconLucideShuffle /></template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack"
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
                :class="repeatMode === 'off' ? 'opacity-40' : 'opacity-100'"
                @click="player.cycleRepeatMode()"
              >
                <template #icon>
                  <IconLucideRepeat1 v-if="repeatMode === 'one'" />
                  <IconLucideRepeat v-else />
                </template>
              </SButton>
            </div>
            <div class="flex items-center gap-2 w-full max-w-120">
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(position) }}
              </span>
              <SSlider
                :model-value="position"
                :min="0"
                :max="duration"
                :step="100"
                :always-show-thumb="false"
                class="flex-1"
                @drag-end="onSeekDragEnd"
              />
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(duration) }}
              </span>
            </div>
          </div>

          <!-- 工具栏 -->
          <Toolbar cover class="justify-end" />
        </div>
      </div>
    </Transition>
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
</style>
