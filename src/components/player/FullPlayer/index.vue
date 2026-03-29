<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import EffectsLyrics from "@/components/player/EffectsLyrics/index.vue";
import SimpleLyrics from "@/components/player/SimpleLyrics/index.vue";
import * as player from "@/core/player";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlaying, isLoading, position, duration, isExpanded, repeatMode, shuffleMode } =
  storeToRefs(status);

/** 歌词渲染模式 */
const lyricMode = computed(() => settings.player.lyricMode);

/** 歌词组件引用（两种模式共享同一接口） */
const lyricRef = ref<InstanceType<typeof EffectsLyrics> | InstanceType<typeof SimpleLyrics>>();

/** 精确播放时间（毫秒） */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs);
  }
});

/** 歌词组件是否已挂载（首次展开后常驻，不再销毁） */
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

const togglePlay = (): void => {
  if (!hasTrack.value) return;
  if (isPlaying.value) {
    player.pause();
  } else {
    player.play();
  }
};

const collapse = (): void => {
  isExpanded.value = false;
};

const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const min = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
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
        class="fixed inset-0 z-200 bg-surface overflow-hidden text-cover after:content-[''] after:absolute after:left-1/2 after:top-0 after:bottom-0 after:w-px after:bg-[rgba(255,0,0,0.5)] after:z-999 after:pointer-events-none"
        style="
          --lp-color: rgb(var(--s-cover));
          --s-slider-track-bg: rgb(var(--s-cover) / 0.25);
          --s-slider-fill-bg: rgb(var(--s-cover));
          --s-slider-thumb-bg: rgb(var(--s-cover));
        "
      >
        <!-- 背景 -->
        <PlayerBackground />

        <!-- 收起按钮 -->
        <SButton
          type="cover"
          variant="ghost"
          round
          size="large"
          class="absolute top-4 right-4 z-10"
          @click="collapse"
        >
          <template #icon><IconLucideChevronDown /></template>
        </SButton>

        <!-- 左侧：封面 + 歌曲信息 -->
        <div
          class="absolute top-14 left-0 bottom-20 w-[45%] flex items-center justify-center px-12 transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :style="coverCentered ? 'transform: translateX(calc(100% * 11 / 18))' : undefined"
        >
          <!-- 封面 + 歌曲信息：切歌时整体左右淡入淡出 -->
          <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[10vh]">
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
          class="lyric-area absolute top-14 right-0 bottom-20 pr-20 w-[55%] text-[clamp(1.5rem,3.5vw,3rem)] font-bold transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :class="coverCentered ? 'opacity-0 pointer-events-none' : 'opacity-100'"
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

        <!-- 底部控制栏：与外部 PlayerBar 同高 h-20 -->
        <div class="absolute bottom-0 left-0 right-0 h-20 flex flex-col justify-center px-4">
          <!-- 控制按钮行 -->
          <div class="flex items-center h-full">
            <!-- 左侧留空（对齐外部歌曲信息区） -->
            <div class="w-50 shrink-0" />

            <!-- 中部：控制按钮 + 进度条 -->
            <div class="flex-1 flex flex-col items-center gap-1">
              <div class="flex items-center gap-3">
                <!-- 随机模式 -->
                <SButton
                  type="cover"
                  variant="ghost"
                  circle
                  :class="shuffleMode === 'on' ? 'opacity-100' : 'opacity-40'"
                  @click="player.toggleShuffleMode()"
                >
                  <template #icon><IconLucideShuffle /></template>
                </SButton>
                <!-- 上一曲 -->
                <SButton
                  type="cover"
                  variant="ghost"
                  circle
                  :disabled="!hasTrack"
                  @click="player.prevTrack()"
                >
                  <template #icon><IconLucideSkipBack /></template>
                </SButton>
                <!-- 播放/暂停 -->
                <SButton
                  type="cover"
                  variant="secondary"
                  size="large"
                  circle
                  :loading="isLoading"
                  :disabled="!hasTrack && !isLoading"
                  @click="togglePlay"
                >
                  <template #icon>
                    <IconLucidePause v-if="isPlaying" />
                    <IconLucidePlay v-else />
                  </template>
                </SButton>
                <!-- 下一曲 -->
                <SButton
                  type="cover"
                  variant="ghost"
                  circle
                  :disabled="!hasTrack"
                  @click="player.nextTrack()"
                >
                  <template #icon><IconLucideSkipForward /></template>
                </SButton>
                <!-- 循环模式 -->
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
              <!-- 进度条（按钮下方） -->
              <div class="flex items-center gap-2 w-full max-w-lg">
                <span class="text-xs text-cover/50 min-w-9 text-center">{{
                  formatTime(position)
                }}</span>
                <SSlider
                  :model-value="position"
                  :min="0"
                  :max="duration"
                  :step="100"
                  class="flex-1"
                  @drag-end="onSeekDragEnd"
                />
                <span class="text-xs text-cover/50 min-w-9 text-center">{{
                  formatTime(duration)
                }}</span>
              </div>
            </div>

            <!-- 右侧：音量 -->
            <div class="flex items-center gap-2 w-36 shrink-0">
              <IconLucideVolume2 class="size-4 text-cover/50 shrink-0" />
              <SSlider
                :model-value="status.volume"
                :min="0"
                :max="1"
                :step="0.01"
                always-show-thumb
                :thumb-size="12"
                :track-height="3"
                class="flex-1"
                @change="player.setVolume($event)"
              />
            </div>
          </div>
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
