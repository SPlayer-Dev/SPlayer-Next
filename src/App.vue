<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

watchEffect(() => {
  const v = useSettingsStore().appearance.fontFamily;
  const root = document.documentElement.style;
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <AppBackground />
  <RouterView />
</template>
