<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";

const theme = useThemeStore();

/** 仅当生效风格为 image 时挂载 DOM；solid 时整个组件不渲染 */
const visible = computed(
  () => theme.effectiveStyle === "image" && !!theme.imageBackground.src,
);

/** 底图永远 object-fit:cover；再叠 transform:scale 控制缩放（>1 溢出可掩盖模糊白边） */
const imageStyle = computed<Record<string, string>>(() => ({
  objectFit: "cover",
  filter: theme.imageBackground.blur > 0 ? `blur(${theme.imageBackground.blur}px)` : "none",
  transform: `scale(${theme.imageBackground.scale})`,
}));
</script>

<template>
  <div v-if="visible" class="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
    <img
      :src="theme.imageBackground.src"
      class="w-full h-full select-none"
      :style="imageStyle"
      draggable="false"
      alt=""
    />
    <div
      class="absolute inset-0 bg-black transition-opacity"
      :style="{ opacity: theme.imageBackground.dim }"
    />
  </div>
</template>
