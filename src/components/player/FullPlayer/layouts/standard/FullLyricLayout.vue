<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useFullPlayer } from "../../context";

const status = useStatusStore();
const media = useMediaStore();
const { onMainMove } = useFullPlayer();

const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 全屏歌词没有隐藏歌词的入口，歌词仅让位给播放队列 */
const lyricVisible = computed(() => hasLyric.value && !status.fullQueueOpen);
</script>

<template>
  <PlayerTopBar lyric-disabled :lyric-active="false" />
  <div class="absolute top-14 inset-x-0 bottom-20" @mousemove="onMainMove">
    <div
      class="group absolute inset-0 px-20 flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="status.fullQueueOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'"
    >
      <PlayerLyric :visible="lyricVisible">
        <template #header>
          <div class="shrink-0 pt-2 pb-6">
            <PlayerData simple />
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
