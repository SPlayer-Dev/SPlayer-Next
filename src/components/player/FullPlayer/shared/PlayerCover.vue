<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

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

const motion = shallowRef<{ key: string; src: string } | null>(null);
const motionReady = ref(false);
const videoRef = ref<HTMLVideoElement>();

watch(
  () =>
    [
      status.isPlayerExpanded && !status.trackLoading,
      settings.player.motionCoverSource,
      displayTrack.value?.id,
    ] as const,
  async ([active, source, id]) => {
    const key = `${source}:${id}`;
    if (motion.value && motion.value.key !== key) {
      motion.value = null;
      motionReady.value = false;
    }
    if (!active || source === "off" || !id || !displayTrack.value || motion.value) return;
    const src = await window.api.motionCover.resolve(toRaw(displayTrack.value), source);
    if (src && `${settings.player.motionCoverSource}:${displayTrack.value?.id}` === key) {
      motion.value = { key, src };
    }
  },
  { immediate: true },
);

// 跟随播放暂停
watch([videoRef, () => status.isPlaying], ([video, playing]) => {
  if (!video) return;
  if (playing) video.play().catch(() => {});
  else video.pause();
});
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面加载与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <!-- 切歌交叉淡入 -->
    <Transition
      :duration="500"
      enter-active-class="z-1 transition-opacity duration-500 ease-linear"
      enter-from-class="opacity-0"
    >
      <DetailCover
        :key="displayTrack?.id"
        :src="coverSrc"
        :fallback="displayTrack?.cover"
        class="absolute! inset-0 size-full"
      />
    </Transition>
    <!-- 动态封面 -->
    <Transition leave-active-class="transition-opacity duration-500" leave-to-class="opacity-0">
      <video
        v-if="motion && status.isPlayerExpanded"
        ref="videoRef"
        :key="motion.src"
        :src="motion.src"
        muted
        loop
        playsinline
        class="absolute inset-0 z-2 size-full object-cover transition-opacity duration-500"
        :class="motionReady ? 'opacity-100' : 'opacity-0'"
        @loadeddata="motionReady = true"
      />
    </Transition>
  </div>
</template>
