<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import EffectsLyrics from "@/components/player/EffectsLyrics/index.vue";
import * as player from "@/core/player";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlaying, isLoading, position, duration, isExpanded, repeatMode, shuffleMode } =
  storeToRefs(status);

/** 歌词组件引用 */
const lyricRef = ref<InstanceType<typeof EffectsLyrics>>();

/** 60fps 精确播放时间（毫秒），歌曲或歌词加载中暂停推送避免旧歌词跳动 */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs);
  }
});

/** 歌词是否激活（展开后挂载，收起动画结束后卸载） */
const lyricActive = ref(false);

/** 展开前：挂载歌词 + 恢复渲染 + 启动时钟 */
const onBeforeEnter = () => {
  lyricActive.value = true;
  nextTick(() => {
    lyricRef.value?.resume();
    startTick();
  });
};

/** 收起前：冻结歌词渲染 + 停止时钟 */
const onBeforeLeave = () => {
  lyricRef.value?.freeze();
  stopTick();
};

/** 收起动画结束后：卸载歌词组件释放 DOM */
const onAfterLeave = () => {
  lyricActive.value = false;
};

const hasTrack = computed(() => !!media.track);

/** 无歌词时居中封面（歌词加载中不触发，避免切歌抖动） */
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

const onSeek = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
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
      @before-leave="onBeforeLeave"
      @after-leave="onAfterLeave"
    >
      <div v-show="isExpanded" class="fixed inset-0 z-200 bg-surface overflow-hidden text-cover after:content-[''] after:absolute after:left-1/2 after:top-0 after:bottom-0 after:w-px after:bg-[rgba(255,0,0,0.5)] after:z-999 after:pointer-events-none" style="--lp-color: rgb(var(--s-cover))">
        <!-- 背景 -->
        <PlayerBackground />

        <!-- 收起按钮 -->
        <SButton
          type="cover"
          variant="ghost"
          circle
          size="small"
          class="absolute top-4 right-4 z-10"
          @click="collapse"
        >
          <template #icon><IconLucideChevronDown /></template>
        </SButton>

        <!-- 左侧：封面 + 歌曲信息 -->
        <div
          class="absolute top-0 left-0 bottom-18 w-[45%] flex flex-col items-center justify-center gap-6 px-12 transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :style="coverCentered ? 'transform: translateX(calc(100% * 11 / 18))' : undefined"
        >
          <!-- 封面 -->
          <div class="w-[70%] max-w-[50vh]">
            <PlayerCover />
          </div>
          <!-- 歌曲信息 -->
          <div v-if="media.track" class="w-[70%] max-w-[50vh] text-center">
            <div class="text-xl font-semibold truncate">
              {{ media.track.title }}
            </div>
            <div class="text-sm text-cover/60 mt-1.5 truncate">
              {{ media.track.artists.map((a) => a.name).join(" / ") }}
            </div>
          </div>
        </div>

        <!-- 右侧：歌词区域 -->
        <div
          class="absolute top-0 right-0 bottom-18 w-[55%] text-[clamp(1.5rem,3.5vw,3rem)] font-bold transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
          :class="coverCentered ? 'opacity-0 pointer-events-none' : 'opacity-100'"
        >
          <EffectsLyrics
            v-if="lyricActive && (media.parsedLyric.length > 0 || media.lyricLoading)"
            ref="lyricRef"
            :lyric-lines="media.parsedLyric"
            :playing="isPlaying"
            @seek="player.seek($event)"
          />
          <div
            v-else-if="!media.lyricLoading"
            class="w-full h-full flex items-center justify-center text-cover/30"
          >
            暂无歌词
          </div>
        </div>

        <!-- 底部控制栏：与外部 PlayerBar 同高 h-18 -->
        <div class="absolute bottom-0 left-0 right-0 h-18 flex flex-col justify-center px-4">
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
                <input
                  type="range"
                  min="0"
                  :max="duration"
                  step="100"
                  :value="position"
                  class="flex-1 accent-primary"
                  @input="onSeek"
                />
                <span class="text-xs text-cover/50 min-w-9 text-center">{{
                  formatTime(duration)
                }}</span>
              </div>
            </div>

            <!-- 右侧：音量 -->
            <div class="flex items-center gap-2 w-36 shrink-0">
              <IconLucideVolume2 class="size-4 text-cover/50 shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="status.volume"
                class="flex-1 accent-primary"
                @input="player.setVolume(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

