<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import BackgroundRender from "./BackgroundRender.vue";

const props = defineProps<{
  /** 保持背景到面板退出动画结束 */
  visible: boolean;
  /** 允许初始化流体渲染器 */
  active: boolean;
}>();

const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();

const bgType = computed(() => settings.player.playerBgType as string);

const fluidReady = ref(false);
const showBlurPreview = ref(true);

watch([() => props.active, bgType, () => settings.player.playerBgRenderer], () => {
  fluidReady.value = false;
  showBlurPreview.value = true;
});

/** 淡入结束后隐藏预览，避免长期叠加两套背景合成层 */
const onFluidTransitionEnd = (event: TransitionEvent): void => {
  if (
    event.target === event.currentTarget &&
    event.propertyName === "opacity" &&
    fluidReady.value
  ) {
    showBlurPreview.value = false;
  }
};

// 流体背景播放态
const bgPlaying = computed(() => {
  if (!status.isPlayerExpanded) return false;
  if (!status.isPlaying && settings.player.playerBgFreezeOnPause) return false;
  return true;
});

// 模糊模式：双缓冲层，切歌时交叉淡入淡出
const initialCover = media.track?.cover || DEFAULT_COVER;
const blurLayers = reactive([
  { src: initialCover, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch([() => media.track?.cover, () => status.isPlayerExpanded], ([newCover, expanded]) => {
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
});

onBeforeUnmount(() => {
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
  <div class="absolute inset-0 overflow-hidden -z-1 bg-solid-wrap">
    <div class="color bg-cover-base" />
  </div>
  <!-- 流体背景就绪前用缩略图铺底 -->
  <div
    v-if="(bgType === 'blur' || bgType === 'animation') && props.visible"
    v-show="showBlurPreview"
    class="absolute inset-0 overflow-hidden -z-1 bg-blur-wrap"
  >
    <img
      v-for="(layer, index) in blurLayers"
      :key="index"
      :src="layer.src"
      :class="['bg-img', { active: layer.active }]"
      decoding="async"
      alt=""
    />
  </div>
  <!-- 流体背景 -->
  <div
    v-if="bgType === 'animation' && props.active"
    class="absolute inset-0 overflow-hidden -z-1 bg-fluid-wrap"
    :class="{ ready: fluidReady }"
    @transitionend="onFluidTransitionEnd"
  >
    <BackgroundRender
      :album="media.track?.cover || DEFAULT_COVER"
      :playing="bgPlaying"
      :fps="settings.player.playerBgFps"
      :flow-speed="settings.player.playerBgFlowSpeed"
      :render-scale="settings.player.playerBgRenderScale"
      :has-lyric="media.parsedLyric.length > 0"
      :enable-beat="settings.player.playerBgBeat"
      :render-engine="settings.player.playerBgRenderer"
      @ready="fluidReady = true"
    />
  </div>
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

/* 纹理就绪后再显露流体画面 */
.bg-fluid-wrap {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.bg-fluid-wrap.ready {
  opacity: 1;
}
</style>
