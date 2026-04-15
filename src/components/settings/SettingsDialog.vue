<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";

const dialog = useSettingsDialog();
const { open } = dialog;

const unsubscribe = window.api.system.onOpenSettings(({ category, highlight }) => {
  dialog.show(category, highlight);
});

onBeforeUnmount(() => unsubscribe());
</script>

<template>
  <SDialog v-model:open="open" width="min(1024px, calc(100vw - 40px))" height="75vh">
    <SettingsContent class="h-full" />
  </SDialog>
</template>
