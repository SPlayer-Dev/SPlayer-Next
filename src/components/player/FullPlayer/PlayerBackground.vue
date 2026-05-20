<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { useMediaStore } from "@/stores/media";
import DEFAULT_COVER from "@/assets/images/song.jpg";

const media = useMediaStore();
const settings = useSettingsStore();
const theme = useThemeStore();

const bgType = computed(() => settings.player.playerBgType);

// 封面颜色（纯色模式）
const coverColor = computed(() => {
  const hex = theme.coverColor;
  if (!hex) return "20, 20, 28";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
});

// 模糊模式：双缓冲层，切歌时交叉淡入淡出
const initialCover = media.track?.coverOriginal || media.track?.cover || DEFAULT_COVER;
const blurLayers = reactive([
  { src: initialCover, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch(
  () => media.track?.coverOriginal || media.track?.cover,
  (newCover) => {
    const token = ++switchToken;

    if (preloadImg) {
      preloadImg.onload = null;
      preloadImg.onerror = null;
      preloadImg.src = "";
      preloadImg = null;
    }

    const nextIndex = currentLayerIndex === 0 ? 1 : 0;
    const switchLayer = (src: string) => {
      if (token !== switchToken) return;
      preloadImg = null;
      blurLayers[nextIndex].src = src;
      nextTick(() => {
        if (token !== switchToken) return;
        requestAnimationFrame(() => {
          if (token !== switchToken) return;
          blurLayers[nextIndex].active = true;
          blurLayers[currentLayerIndex].active = false;
          currentLayerIndex = nextIndex;
        });
      });
    };

    const targetCover = newCover || DEFAULT_COVER;

    const img = new Image();
    preloadImg = img;
    img.onload = () => switchLayer(targetCover);
    img.onerror = () => switchLayer(DEFAULT_COVER);
    img.src = targetCover;
  },
);

onBeforeUnmount(() => {
  if (preloadImg) {
    preloadImg.onload = null;
    preloadImg.onerror = null;
    preloadImg.src = "";
    preloadImg = null;
  }
  blurLayers[0].src = "";
  blurLayers[1].src = "";
});
</script>

<template>
  <!-- 模糊背景 -->
  <div v-if="bgType === 'blur'" class="absolute inset-0 overflow-hidden -z-1 bg-blur-wrap">
    <img
      v-for="(layer, index) in blurLayers"
      :key="index"
      :src="layer.src"
      :class="['bg-img', { active: layer.active }]"
      alt=""
    />
  </div>

  <!-- 纯色背景 -->
  <div v-else class="absolute inset-0 overflow-hidden -z-1 bg-solid-wrap">
    <Transition name="fade">
      <div
        :key="media.track?.coverOriginal || media.track?.cover"
        class="color"
        :style="{ backgroundColor: `rgb(${coverColor})` }"
      />
    </Transition>
  </div>
</template>

<style scoped>
/* 公共：遮罩层 */
.bg-blur-wrap::after,
.bg-solid-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
}

/* 模糊模式 */
.bg-blur-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blur-wrap .bg-img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.5);
  filter: blur(45px) saturate(1.2);
  opacity: 0;
  transition: opacity 0.5s ease-in-out;
}

.bg-blur-wrap .bg-img.active {
  opacity: 1;
}

/* 纯色模式 */
.bg-solid-wrap {
  background-color: rgb(20, 20, 28);
}

.bg-solid-wrap .color {
  width: 100%;
  height: 100%;
  transition: background-color 0.5s ease;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
  position: absolute;
  inset: 0;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
