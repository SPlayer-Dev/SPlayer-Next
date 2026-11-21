<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useWindowControls } from "@/composables/useWindowControls";
import { isMac } from "@/utils/config";
import { MACOS_TITLE_BAR_HEIGHT } from "@shared/constants/window";

const settings = useSettingsStore();
const { isBorderless, isFullscreen } = useWindowControls();
const zoomFactor = ref(window.api.window.getZoomFactor());

useEventListener(window, "resize", () => {
  zoomFactor.value = window.api.window.getZoomFactor();
});

watchEffect(() => {
  document.documentElement.toggleAttribute("data-reduced-motion", settings.reducedMotion);
  const v = settings.appearance.fontFamily;
  const root = document.documentElement.style;
  // 按钮隐藏时系统安全区变为零，仍保留原高度避免播放器内容跳动
  root.setProperty(
    "--s-native-titlebar-height",
    `${isMac && !isBorderless.value && !isFullscreen.value ? MACOS_TITLE_BAR_HEIGHT / zoomFactor.value : 0}px`,
  );
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <AppBackground />
  <RouterView />
</template>
