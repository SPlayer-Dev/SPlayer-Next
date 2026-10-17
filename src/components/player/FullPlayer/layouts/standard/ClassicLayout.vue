<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import PlayerComments from "../../shared/PlayerComments.vue";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const { isPlaying, showLyric } = storeToRefs(status);

/** 加载中的歌曲使用队列当前项兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);
const coverWidth = computed(() => `${settings.player.coverLyricRatio * 100}%`);

/** 不看队列时封面是否居中 */
const centeredWithoutQueue = computed(
  () => !showLyric.value || (settings.player.autoCenterCover && !hasLyric.value),
);

const coverCentered = computed(
  () => !status.fullQueueOpen && !status.fullCommentsOpen && centeredWithoutQueue.value,
);

/** 全屏内嵌评论布局：off 关闭、half 左半屏、full 全屏 */
const commentsMode = computed<"off" | "half" | "full">(() => {
  if (!status.fullCommentsOpen) return "off";
  // 以实际就绪的歌词判定，避免歌词加载中导致面板宽度反复切换
  return media.parsedLyric.length > 0 && showLyric.value ? "half" : "full";
});

const lyricVisible = computed(() => showLyric.value && hasLyric.value && !status.fullQueueOpen);

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
  <PlayerTopBar>
    <template #left>
      <SButton
        type="cover"
        variant="ghost"
        circle
        :size="40"
        :disabled="!hasLyric"
        :class="lyricVisible ? 'opacity-100' : 'opacity-40'"
        @click="toggleLyric"
      >
        <template #icon><IconLucideTextQuote /></template>
      </SButton>
    </template>
  </PlayerTopBar>
  <div class="absolute top-14 inset-x-0 bottom-20">
    <!-- 左侧封面与信息 -->
    <div
      class="absolute inset-y-0 left-0 flex items-center justify-center px-12 transition-[transform,opacity] duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="status.fullCommentsOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'"
      :style="{
        width: coverWidth,
        transform: coverCentered ? 'translateX(calc(50vw - 50%))' : undefined,
      }"
    >
      <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[11vh]">
        <Transition name="scale-switch" mode="out-in">
          <div :key="displayTrack?.id">
            <PlayerCover
              class="w-full aspect-square rounded-[32px] shadow-[0_0_20px_10px_rgba(0,0,0,0.1)] [transition:transform_500ms_cubic-bezier(0.34,1.56,0.64,1),box-shadow_500ms_ease-out]"
              :class="isPlaying ? 'scale-100' : 'scale-90'"
            />
            <div class="absolute top-full left-0 w-full pt-6">
              <PlayerData align="left" />
            </div>
          </div>
        </Transition>
      </div>
    </div>
    <!-- 右侧歌词 -->
    <div
      class="group absolute inset-y-0 right-0 pr-20 flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="
        coverCentered || status.fullQueueOpen || commentsMode === 'full'
          ? 'opacity-0 pointer-events-none'
          : 'opacity-100'
      "
      :style="{ width: `calc(100% - ${coverWidth})` }"
    >
      <PlayerLyric :visible="lyricVisible" />
      <LyricActions />
    </div>
    <!-- 全屏内嵌评论 -->
    <PlayerComments :mode="commentsMode === 'full' ? 'full' : 'half'" :width="coverWidth" />
    <!-- 播放队列 -->
    <div
      class="absolute inset-y-0 right-0 pl-4 py-6 flex items-center"
      :class="status.fullQueueOpen ? '' : 'pointer-events-none'"
      :style="{ width: `calc(100% - ${coverWidth})` }"
    >
      <Transition
        :enter-active-class="`transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)] ${centeredWithoutQueue ? 'delay-300' : ''}`"
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
  <PlayerBottomBar />
</template>
