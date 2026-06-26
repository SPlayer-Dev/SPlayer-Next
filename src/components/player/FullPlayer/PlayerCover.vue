<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useParallaxTilt } from "@/composables/useParallaxTilt";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const { isPlaying } = storeToRefs(status);

/** 高清封面缓存 */
const hdCache = shallowRef<{ id: string; data: string } | null>(null);

/** 3D 视差倾斜 */
const { tiltStyle, onMouseMove, onMouseLeave } = useParallaxTilt({ maxTilt: 8 });

/** 是否启用视差 */
const parallaxEnabled = computed(() => settings.player.enableParallaxTilt);

/** 是否启用呼吸效果 */
const breathingEnabled = computed(() => settings.player.enableCoverBreathing);

/** 封面缩放：暂停时缩小到 0.9 */
const coverScale = computed(() => (isPlaying.value ? 1 : 0.9));

/**
 * 组合 transform：视差倾斜 + 缩放
 * 当启用视差时，scale 必须拼接到 tiltStyle 末尾，否则会被 class 的 scale 覆盖
 */
const coverTransform = computed(() => {
  if (!parallaxEnabled.value) return undefined;
  return `${tiltStyle.value} scale(${coverScale.value})`;
});

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === media.track?.id
    ? hdCache.value.data
    : media.track?.coverOriginal || media.track?.cover,
);

watchEffect(async () => {
  const id = media.track?.id;
  if (!status.isExpanded || status.trackLoading || !id) return;
  if (media.track?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (media.track?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
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
            // 视差关闭时用 class 控制 scale；视差开启时由 coverTransform 控制
            !parallaxEnabled ? (isPlaying ? 'scale-100' : 'scale-90') : '',
          ]
    "
    :style="!fullscreen ? { transform: coverTransform } : undefined"
    @mousemove="!fullscreen && parallaxEnabled && onMouseMove($event)"
    @mouseleave="!fullscreen && parallaxEnabled && onMouseLeave()"
  >
    <SImg :src="coverSrc" class="size-full" :class="{ 'cover-breathing': isPlaying && !fullscreen && breathingEnabled }" />
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

/** 封面呼吸效果：播放时轻微缩放脉动 */
.cover-breathing {
  animation: cover-breathe 4s ease-in-out infinite;
}

@keyframes cover-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
</style>
