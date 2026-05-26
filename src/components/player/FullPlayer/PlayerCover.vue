<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const { isPlaying } = storeToRefs(status);

/** 高清封面缓存 */
const hdCache = shallowRef<{ id: string; data: string } | null>(null);

const coverSrc = computed(() =>
  hdCache.value?.id === media.track?.id
    ? hdCache.value!.data
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
  <div :class="['player-cover', { playing: isPlaying, fullscreen }]">
    <SImg :src="coverSrc" class="size-full" />
  </div>
</template>

<style scoped>
.player-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 32px;
  overflow: hidden;
  flex-shrink: 0;
  background-color: black;
  transform: scale(0.9);
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 20px 10px rgba(0, 0, 0, 0.1);
}

.player-cover.playing {
  transform: scale(1);
}

/* 全屏封面 */
.player-cover.fullscreen {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  background-color: transparent;
  transform: none;
  box-shadow: none;
  --cover-fade: linear-gradient(
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
  mask-image: var(--cover-fade);
  -webkit-mask-image: var(--cover-fade);
}
</style>
