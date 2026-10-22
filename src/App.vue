<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

const settings = useSettingsStore();

watchEffect(() => {
  document.documentElement.toggleAttribute("data-reduced-motion", settings.reducedMotion);
  const v = settings.appearance.fontFamily;
  const root = document.documentElement.style;
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <AppBackground />
  <RouterView />
</template>
