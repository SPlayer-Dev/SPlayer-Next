<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { usePlaybackTime } from "@/composables/usePlaybackTime";

const status = useStatusStore();
const media = useMediaStore();
const { isPlaying, isLoading, position, duration, isExpanded } = storeToRefs(status);

/**
 * 内容激活标记：展开时立即激活，收起后延迟销毁（等动画结束）
 * 重型子组件用 v-if="isActive" 控制，收起时冻结/卸载
 */
const isActive = ref(false);

/** 60fps 精确播放时间（毫秒） */
const preciseTime = ref(0);
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  preciseTime.value = currentMs;
});

watch(isActive, (val) => {
  if (val) startTick();
  else stopTick();
});
let deactivateTimer: ReturnType<typeof setTimeout> | null = null;

watch(isExpanded, (val) => {
  if (val) {
    if (deactivateTimer) { clearTimeout(deactivateTimer); deactivateTimer = null; }
    isActive.value = true;
  } else {
    deactivateTimer = setTimeout(() => { isActive.value = false; }, 350);
  }
});

const hasTrack = computed(() => !!media.track);

const togglePlay = (): void => {
  if (!hasTrack.value) return;
  if (isPlaying.value) {
    status.pause();
  } else {
    status.play();
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
  status.seek(value);
};
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div
        v-show="isExpanded"
        class="fixed inset-0 z-200 bg-surface flex flex-col items-center justify-center gap-8"
      >
        <!-- 收起按钮 -->
        <SButton
          variant="ghost"
          circle
          size="small"
          class="absolute top-4 right-4"
          @click="collapse"
        >
          <template #icon><IconLucideChevronDown /></template>
        </SButton>

        <!-- 封面 -->
        <img
          v-if="media.track?.cover"
          :src="media.track.cover"
          class="w-64 h-64 rounded-2xl object-cover shadow-xl bg-surface-alt"
        />

        <!-- 歌曲信息 -->
        <div v-if="media.track" class="text-center px-8">
          <div class="text-xl font-semibold">{{ media.track.title }}</div>
          <div class="text-sm text-on-surface-variant mt-1">
            {{ media.track.artists.map((a) => a.name).join(" / ") }}
          </div>
        </div>

        <!-- 精确播放时间（测试用） -->
        <div class="text-2xl font-mono text-primary tabular-nums">
          {{ preciseTime }}ms
        </div>

        <!-- 进度条 -->
        <div class="flex items-center gap-3 w-full max-w-sm px-8">
          <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
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
          <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
            formatTime(duration)
          }}</span>
        </div>

        <!-- 播放控制 -->
        <div class="flex items-center gap-6">
          <SButton variant="ghost" circle size="large" :disabled="!hasTrack" @click="status.stop()">
            <template #icon><IconLucideSquare /></template>
          </SButton>
          <SButton
            type="primary"
            circle
            size="large"
            :loading="isLoading"
            :disabled="!hasTrack && !isLoading"
            @click="togglePlay"
          >
            <template #icon>
              <IconLucidePause v-if="isPlaying" />
              <IconLucidePlay v-else />
            </template>
          </SButton>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
