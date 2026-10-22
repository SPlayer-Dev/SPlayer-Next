<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";

const SettingsContent = defineAsyncComponent(() => import("./SettingsContent.vue"));

const dialog = useSettingsDialog();
const { open } = dialog;
const { t } = useI18n();

const unsubscribe = window.api.system.onOpenSettings(({ category, highlight }) => {
  dialog.show(category, highlight);
});

onBeforeUnmount(() => unsubscribe());
</script>

<template>
  <SDialog
    v-model:open="open"
    width="min(1024px, calc(100vw - 40px))"
    height="75vh"
    destroy-on-close
  >
    <Suspense>
      <SettingsContent class="h-full" />
      <template #fallback>
        <div class="h-full flex items-center justify-center gap-2 text-on-surface-variant">
          <SLoading class="size-5 text-primary" />
          {{ t("common.loading") }}
        </div>
      </template>
    </Suspense>
  </SDialog>
</template>
