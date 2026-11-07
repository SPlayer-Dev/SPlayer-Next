<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { setPlayerExpanded } from "@/services/playerTransition";
import { useFullPlayer } from "../../context";

const { t } = useI18n();
const status = useStatusStore();
const media = useMediaStore();
const { showLyric } = storeToRefs(status);
const { onBarEnter, onBarLeave } = useFullPlayer();

const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 不看队列时信息列是否居中 */
const centeredWithoutQueue = computed(() => !showLyric.value || !hasLyric.value);

/** 歌词隐藏或无歌词时，信息列平移到屏幕中央 */
const infoCentered = computed(() => !status.fullQueueOpen && centeredWithoutQueue.value);

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
  <PlayerTopBar />
  <!-- 收起把手 -->
  <div class="app-no-drag absolute top-4 left-1/2 -translate-x-1/2 z-20">
    <SButton
      type="cover"
      variant="ghost"
      size="auto"
      class="px-4 py-3 rounded-full"
      :aria-label="t('player.collapse')"
      @click="setPlayerExpanded(false)"
    >
      <span class="block w-14 h-1.2 rounded-full bg-cover/40" />
    </SButton>
  </div>
  <div class="absolute top-14 inset-x-0 bottom-16">
    <!-- 左侧封面与控制 -->
    <div
      class="absolute inset-y-0 left-0 w-[45%] flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.5,0,0.5,1)]"
      :style="{ transform: infoCentered ? 'translateX(calc(50vw - 50%))' : undefined }"
    >
      <div class="w-[min(50vh,38vw)] flex flex-col gap-[4vh]">
        <PlayerCover
          class="w-full aspect-square rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.3)] transition-shadow duration-500 ease-out"
        />
        <AppleControls />
      </div>
    </div>
    <!-- 右侧歌词 -->
    <div
      class="group absolute inset-y-0 right-0 w-[55%] pr-20 flex flex-col transition-opacity duration-500 ease-[cubic-bezier(0.5,0,0.5,1)]"
      :class="lyricVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'"
    >
      <PlayerLyric :visible="lyricVisible" />
      <LyricActions />
    </div>
    <!-- 播放队列 -->
    <div
      class="absolute inset-y-0 right-0 w-[55%] pl-4 py-6 flex items-center"
      :class="status.fullQueueOpen ? '' : 'pointer-events-none'"
    >
      <!-- 封面需移开时延后淡入 -->
      <Transition
        :enter-active-class="`transition-opacity duration-500 ${centeredWithoutQueue ? 'delay-250' : ''}`"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-500"
        leave-to-class="opacity-0"
      >
        <div v-if="status.fullQueueOpen" class="w-full h-full">
          <QueuePanel @close="status.fullQueueOpen = false" />
        </div>
      </Transition>
    </div>
  </div>
  <!-- 右下角开关 -->
  <div
    data-player-layout="bottom-bar"
    class="absolute bottom-4 right-6 h-16 z-10 flex items-center gap-4"
    @mouseenter="onBarEnter"
    @mouseleave="onBarLeave"
  >
    <SButton
      type="cover"
      variant="text"
      size="auto"
      class="opacity-45 hover:opacity-80"
      :disabled="!hasLyric"
      @click="toggleLyric"
    >
      <IconSpAmLyricsActive v-if="lyricVisible" class="size-9" />
      <IconSpAmLyrics v-else class="size-9" />
    </SButton>
    <SButton
      type="cover"
      variant="text"
      size="auto"
      class="opacity-45 hover:opacity-80"
      @click="status.fullQueueOpen = !status.fullQueueOpen"
    >
      <IconSpAmPlaylistActive v-if="status.fullQueueOpen" class="size-9" />
      <IconSpAmPlaylist v-else class="size-9" />
    </SButton>
  </div>
</template>
