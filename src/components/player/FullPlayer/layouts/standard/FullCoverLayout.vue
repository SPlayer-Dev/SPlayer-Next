<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useFullPlayer } from "../../context";

const status = useStatusStore();
const media = useMediaStore();
const { immersive } = useFullPlayer();

const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 全屏封面没有隐藏歌词的入口，歌词列仅让位给播放队列 */
const lyricVisible = computed(() => hasLyric.value && !status.fullQueueOpen);
</script>

<template>
  <!-- 封面压在频谱与遮罩之下 -->
  <div class="absolute inset-y-0 left-0 w-[60%] -z-1">
    <PlayerCover class="full-cover size-full" />
  </div>
  <!-- 顶/底栏渐变遮罩 -->
  <div
    data-player-layout="mask-top"
    class="cover-mask-top absolute top-0 inset-x-0 h-20 z-5 pointer-events-none transition-opacity duration-400"
    :class="immersive ? 'opacity-0' : 'opacity-100'"
  />
  <div
    data-player-layout="mask-bottom"
    class="cover-mask-bottom absolute bottom-0 inset-x-0 h-48 z-5 pointer-events-none transition-opacity duration-400"
    :class="immersive ? 'opacity-0' : 'opacity-100'"
  />
  <PlayerTopBar />
  <div class="absolute top-14 inset-x-0 bottom-20">
    <!-- 右侧信息与歌词 -->
    <div
      class="group absolute inset-y-0 right-0 w-1/2 pr-20 flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="status.fullQueueOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'"
    >
      <PlayerLyric :visible="lyricVisible">
        <template #header>
          <div class="shrink-0 pt-2 pb-6 pl-[calc(1em-0.5rem)]">
            <PlayerData align="left" simple />
          </div>
        </template>
      </PlayerLyric>
      <LyricActions />
    </div>
    <!-- 播放队列 -->
    <div
      class="absolute inset-y-0 right-0 w-1/2 pl-4 py-6 flex items-center"
      :class="status.fullQueueOpen ? '' : 'pointer-events-none'"
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
  <PlayerBottomBar />
</template>

<style scoped>
.full-cover {
  mask-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.98) 10%,
    rgba(0, 0, 0, 0.92) 22%,
    rgba(0, 0, 0, 0.82) 32%,
    rgba(0, 0, 0, 0.68) 42%,
    rgba(0, 0, 0, 0.52) 52%,
    rgba(0, 0, 0, 0.36) 62%,
    rgba(0, 0, 0, 0.22) 72%,
    rgba(0, 0, 0, 0.1) 82%,
    rgba(0, 0, 0, 0.03) 92%,
    rgba(0, 0, 0, 0) 100%
  );
}

/* 多段非线性 alpha，避免暗色渐变出色阶 */
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
