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

const coverRef = ref<HTMLImageElement>();
const isLoaded = ref(false);

const onLoad = () => {
  isLoaded.value = true;
  if (coverRef.value) emit("load", coverRef.value);
};

const onError = () => {
  isLoaded.value = false;
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
    <!-- 占位图：文档流撑高度 -->
    <img
      :src="fallback"
      :alt="alt"
      class="s-img-fallback"
      :class="{ hidden: isLoaded }"
    />
    <!-- 真实图：绝对定位叠上去 -->
    <img
      v-if="src"
      ref="coverRef"
      :src="src"
      :alt="alt"
      :class="['s-img-cover', { loaded: isLoaded }]"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.s-img {
  position: relative;
  overflow: hidden;
}

.s-img-fallback {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}

.s-img-fallback.hidden {
  opacity: 0;
}

.s-img-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.s-img-cover.loaded {
  opacity: 1;
}
</style>
