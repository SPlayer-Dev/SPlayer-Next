<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import BackgroundRender from "./BackgroundRender.vue";

const media = useMediaStore();
const settings = useSettingsStore();
const theme = useThemeStore();
const status = useStatusStore();

const bgType = computed(() => settings.player.playerBgType as string);

/**
 * 背景是否就绪
 * 展开后延迟 500ms 再挂载，收起后延迟 500ms 卸载以释放 WebGL 上下文 / 模糊位图
 */
const bgReady = ref(false);
let bgReadyTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => status.isExpanded,
  (expanded) => {
    clearTimeout(bgReadyTimer);
    if (expanded) {
      // 已就绪（快速收起后又展开）则保留，避免无谓地卸载重建
      if (!bgReady.value) {
        bgReadyTimer = setTimeout(() => {
          bgReady.value = true;
        }, 500);
      }
    } else {
      // 等收起动画结束后再卸载
      bgReadyTimer = setTimeout(() => {
        bgReady.value = false;
      }, 500);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(bgReadyTimer));

// 流体背景播放态
const bgPlaying = computed(() => {
  if (!status.isExpanded) return false;
  if (!status.isPlaying && settings.player.playerBgFreezeOnPause) return false;
  return true;
});

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
const initialCover = media.track?.cover || media.track?.coverOriginal || DEFAULT_COVER;
const blurLayers = reactive([
  { src: initialCover, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch(
  [() => media.track?.cover || media.track?.coverOriginal, () => status.isExpanded],
  ([newCover, expanded]) => {
    if (!expanded) return;
    const token = ++switchToken;

    if (preloadImg) {
      preloadImg.src = "";
      preloadImg = null;
    }
    const targetCover = newCover || DEFAULT_COVER;
    // 相同不切换
    if (blurLayers[currentLayerIndex].src === targetCover) return;
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
    const img = new Image();
    preloadImg = img;
    img.src = targetCover;
    img
      .decode()
      .then(() => switchLayer(targetCover))
      .catch(() => switchLayer(DEFAULT_COVER));
  },
);

onBeforeUnmount(() => {
  clearTimeout(bgReadyTimer);
  switchToken++;
  if (preloadImg) {
    preloadImg.src = "";
    preloadImg = null;
  }
  blurLayers[0].src = "";
  blurLayers[1].src = "";
});
</script>

<template>
  <!-- 纯色背景 -->
  <div
    v-if="bgType !== 'blur' && bgType !== 'animation'"
    class="absolute inset-0 overflow-hidden -z-1 bg-solid-wrap"
  >
    <div class="color" :style="{ backgroundColor: `rgb(${coverColor})` }" />
  </div>
  <!-- 模糊背景 -->
  <Transition v-else-if="bgType === 'blur'" name="bg-fade">
    <div v-if="bgReady" class="absolute inset-0 overflow-hidden -z-1 bg-blur-wrap">
      <img
        v-for="(layer, index) in blurLayers"
        :key="index"
        :src="layer.src"
        :class="['bg-img', { active: layer.active }]"
        decoding="async"
        alt=""
      />
    </div>
  </Transition>
  <!-- 流体背景 -->
  <Transition v-else name="bg-fade">
    <div v-if="bgReady" class="absolute inset-0 overflow-hidden -z-1">
      <BackgroundRender
        :album="media.track?.cover || DEFAULT_COVER"
        :playing="bgPlaying"
        :fps="settings.player.playerBgFps"
        :flow-speed="settings.player.playerBgFlowSpeed"
        :render-scale="settings.player.playerBgRenderScale"
        :has-lyric="media.parsedLyric.length > 0"
        :enable-beat="settings.player.playerBgBeat"
      />
    </div>
  </Transition>
</template>

<style scoped>
/* 纯色模式 */
.bg-solid-wrap {
  background-color: rgb(20, 20, 28);
}

.bg-solid-wrap .color {
  width: 100%;
  height: 100%;
  transition: background-color 0.5s ease;
}

/* 模糊模式 */
.bg-blur-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blur-wrap::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1;
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

/* 流体背景渐入 */
.bg-fade-enter-active {
  transition: opacity 0.8s ease-in-out;
}

.bg-fade-leave-active {
  transition: opacity 0.3s ease-in;
}

.bg-fade-enter-from,
.bg-fade-leave-to {
  opacity: 0;
}
</style>
