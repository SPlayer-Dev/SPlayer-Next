<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";

const media = useMediaStore();
const { isPlaying } = storeToRefs(useStatusStore());

// 高清封面 data URL（从主进程按需获取）
const hdCover = ref<string | null>(null);
const coverSrc = computed(() => hdCover.value || media.track?.cover || "/images/song.jpg");

const coverStyle = computed(() => ({
  backgroundImage: `url(${coverSrc.value})`,
}));

// 歌曲切换时获取高清封面，拿到前保持旧封面
watch(
  () => media.track?.id,
  async (newId) => {
    if (!newId) {
      hdCover.value = null;
      return;
    }

    try {
      const result = await window.api.player.getCoverRaw();
      if (media.track?.id !== newId) return;
      hdCover.value = result.success ? (result.data ?? null) : null;
    } catch {
      if (media.track?.id === newId) hdCover.value = null;
    }
  },
  { immediate: true },
);

</script>

<template>
  <div :class="['player-cover', { playing: isPlaying }]" :style="coverStyle" />
</template>

<style scoped>
.player-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 32px;
  overflow: hidden;
  flex-shrink: 0;
  background-color: black;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: scale(0.9);
  transition:
    background-image 0.5s linear,
    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 20px 10px rgba(0, 0, 0, 0.1);
}

.player-cover.playing {
  transform: scale(1);
}
</style>
