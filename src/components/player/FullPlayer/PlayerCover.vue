<script setup lang="ts">
import { getDynamicCover } from "@/apis/song/netease";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { useTimeoutFn } from "@vueuse/core";
import { nextTick } from "vue";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const user = useUserStore();
const { isPlaying } = storeToRefs(status);

/** 加载中的歌曲使用队列当前项作为封面兜底。 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

/** 高清封面缓存 */
const hdCache = shallowRef<{ id: string; data: string } | null>(null);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === displayTrack.value?.id
    ? hdCache.value.data
    : displayTrack.value?.coverOriginal || displayTrack.value?.cover,
);

watchEffect(async () => {
  const id = displayTrack.value?.id;
  if (!status.isPlayerExpanded || status.trackLoading || !id) return;
  if (displayTrack.value?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (displayTrack.value?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

/** 动态封面实现 */
const dynamicCoverUrl = ref<string>("");
const dynamicCoverLoaded = ref<boolean>(false);
const videoRef = ref<HTMLVideoElement | null>(null);

/** 是否处于封面展示模式（非全屏） */
const isCoverMode = computed(() => settings.player.coverLayout !== "fullscreen");

/** 是否在加载中 */
const trackLoading = computed(() => status.trackLoading);

/**
 * 获取动态封面
 * 仅对网易云来源、非全屏模式、已登录且开关开启的歌曲生效
 */
const fetchDynamicCover = async (): Promise<void> => {
  const track = displayTrack.value;
  if (!track) {
    dynamicCoverUrl.value = "";
    return;
  }
  if (
    track.source !== "netease" ||
    !isCoverMode.value ||
    !user.isLoggedIn ||
    !settings.player.dynamicCover ||
    trackLoading.value
  ) {
    dynamicCoverUrl.value = "";
    return;
  }

  // 停止已有的再放送定时器，重置加载状态
  dynamicCoverStop();
  dynamicCoverLoaded.value = false;

  const url = await getDynamicCover(track.id);
  if (displayTrack.value?.id !== track.id) return; // 歌曲已切换
  dynamicCoverUrl.value = url ?? "";
};

/** 封面再放送：视频结束后 2s 重新播放 */
const { start: dynamicCoverStart, stop: dynamicCoverStop } = useTimeoutFn(
  () => {
    dynamicCoverLoaded.value = true;
    nextTick(() => {
      videoRef.value?.play();
    });
  },
  2000,
  { immediate: false },
);

const onDynamicCoverEnded = (): void => {
  dynamicCoverLoaded.value = false;
  dynamicCoverStart();
};

const cleanupDynamicCover = (): void => {
  if (videoRef.value) {
    videoRef.value.pause();
    videoRef.value.src = "";
    videoRef.value.load();
  }
  dynamicCoverUrl.value = "";
  dynamicCoverLoaded.value = false;
};

watch(
  () =>
    [
      displayTrack.value?.id,
      settings.player.dynamicCover,
      settings.player.coverLayout,
      status.trackLoading,
    ] as const,
  () => {
    fetchDynamicCover();
  },
);

onMounted(() => {
  fetchDynamicCover();
});

onBeforeUnmount(() => {
  dynamicCoverStop();
  cleanupDynamicCover();
});
</script>

<template>
  <div
    :class="
      fullscreen
        ? 'player-cover-fullscreen w-full h-full aspect-auto rounded-none bg-transparent overflow-hidden shrink-0'
        : [
            'w-full aspect-square rounded-[32px] overflow-hidden shrink-0',
            'shadow-[0_0_20px_10px_rgba(0,0,0,0.1)]',
            'transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            isPlaying ? 'scale-100' : 'scale-90',
          ]
    "
  >
    <SImg :src="coverSrc" class="size-full" />
    <!-- 动态封面 -->
    <Transition name="fade" mode="out-in">
      <video
        v-if="dynamicCoverUrl && !fullscreen"
        ref="videoRef"
        :src="dynamicCoverUrl"
        :class="['dynamic-cover', { loaded: dynamicCoverLoaded }]"
        muted
        autoplay
        playsinline
        @loadeddata="dynamicCoverLoaded = true"
        @ended="onDynamicCoverEnded"
      />
    </Transition>
  </div>
</template>

<style scoped>
.player-cover-fullscreen {
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

.dynamic-cover {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 32px;
  overflow: hidden;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
  backface-visibility: hidden;
  transform: translateZ(0);

  &.loaded {
    opacity: 1;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
