<script setup lang="ts">
export interface SImgProps {
  /** 图片地址 */
  src?: string;
  /** 占位图地址 */
  fallback?: string;
  /** alt 文字 */
  alt?: string;
}

const props = withDefaults(defineProps<SImgProps>(), {
  fallback: "/images/song.jpg",
  alt: "",
});

const emit = defineEmits<{
  load: [el: HTMLImageElement];
}>();

const isLoaded = ref(false);

const onLoad = (e: Event) => {
  const target = e.target as HTMLImageElement;
  target.style.opacity = "1";
  isLoaded.value = true;
  emit("load", target);
};

watch(
  () => props.src,
  () => {
    isLoaded.value = false;
  },
);
</script>

<template>
  <div class="s-img">
    <!-- 占位图：封面加载完后淡出移除 -->
    <Transition name="fade">
      <img v-if="!isLoaded" :src="fallback" :alt="alt" class="s-img-loading" />
    </Transition>
    <!-- 封面：Transition 控制外层 div 的交叉淡入淡出，img 的 opacity 由 @load 单独控制 -->
    <Transition
      enter-active-class="s-img-transition"
      leave-active-class="s-img-transition"
      enter-from-class="s-img-hidden"
      leave-to-class="s-img-hidden"
    >
      <div v-if="src" :key="src" class="s-img-wrapper">
        <img
          :src="src"
          :alt="alt"
          class="s-img-cover"
          decoding="async"
          loading="lazy"
          @load="onLoad"
          @error="isLoaded = false"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.s-img {
  position: relative;
  overflow: hidden;
}

.s-img-loading {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}

.s-img-wrapper {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.s-img-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.2s;
}

.s-img-transition {
  transition: opacity 0.2s;
}

.s-img-hidden {
  opacity: 0;
}
</style>
