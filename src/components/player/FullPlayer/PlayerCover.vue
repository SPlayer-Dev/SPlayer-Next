<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { songDynamicCover } from "@/apis/song/dynamicCover";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();
const { isPlaying } = storeToRefs(status);

/** 高清封面缓存 */
const hdCache = shallowRef<{ id: string; data: string } | null>(null);

/** 动态封面视频 DOM 引用 */
const videoRef = ref<HTMLVideoElement | null>(null);

/** 动态封面视频 URL */
const bannerVideo = ref("");
const bannerVideoLoaded = ref(false);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === media.track?.id
    ? hdCache.value.data
    : media.track?.coverOriginal || media.track?.cover,
);

/** 是否满足动态封面条件：非本地歌曲 + 有 ID + 用户已开启 + 非全屏布局 */
const canShowDynamicCover = computed(
  () =>
    media.track?.source !== "local" &&
    !!media.track?.id &&
    settings.player.dynamicCover &&
    settings.player.coverLayout !== "fullscreen",
);

/** 视频播放结束后延迟 2 秒自动重播 */
const { start: scheduleReplay, stop: cancelReplay } = useTimeoutFn(() => {
  if (videoRef.value) {
    bannerVideoLoaded.value = true;
    videoRef.value.currentTime = 0;
    void videoRef.value.play();
  }
}, 2000);

/** 视频播放结束回调 */
const bannerVideoEnded = (): void => {
  scheduleReplay();
};

/** 获取动态封面 */
const fetchDynamicCover = async (): Promise<void> => {
  if (!canShowDynamicCover.value) {
    bannerVideo.value = "";
    bannerVideoLoaded.value = false;
    cancelReplay();
    return;
  }
  const trackId = media.track?.id;
  if (!trackId) return;
  cancelReplay();
  bannerVideo.value = "";
  bannerVideoLoaded.value = false;
  try {
    const url = await songDynamicCover(String(trackId));
    bannerVideo.value = url ?? "";
  } catch {
    bannerVideo.value = "";
  }
};

watchEffect(async () => {
  const id = media.track?.id;
  if (!status.isExpanded || status.trackLoading || !id) return;
  if (media.track?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (media.track?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

// 歌曲切换或设置变化时重新获取
watch(
  () => [media.track?.id, settings.player.dynamicCover, settings.player.coverLayout] as const,
  () => fetchDynamicCover(),
);

// 组件卸载时清理视频资源
onBeforeUnmount(() => {
  cancelReplay();
  if (videoRef.value) {
    videoRef.value.pause();
    videoRef.value.src = "";
    videoRef.value.load();
  }
  bannerVideo.value = "";
  bannerVideoLoaded.value = false;
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
    <SImg :src="coverSrc" class="cover-image size-full" />
    <Transition name="fade" mode="out-in">
      <video
        v-if="bannerVideo"
        ref="videoRef"
        :src="bannerVideo"
        :class="['dynamic-cover', { loaded: bannerVideoLoaded }]"
        muted
        autoplay
        @loadeddata="bannerVideoLoaded = true"
        @ended="bannerVideoEnded"
      />
    </Transition>
  </div>
</template>

<style scoped>
.cover-image {
  position: relative;
  z-index: 1;
}

.dynamic-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
}

.dynamic-cover.loaded {
  opacity: 1;
}

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
</style>
