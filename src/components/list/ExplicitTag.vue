<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineProps<{ explicit?: boolean }>();

const { t } = useI18n();
const settings = useSettingsStore();
</script>

<template>
  <span
    v-if="explicit && !settings.preset.hideExplicitTag"
    role="img"
    :aria-label="t('songList.explicitTagLabel')"
    class="shrink-0 self-center leading-none grayscale opacity-60"
  >
    🅴
  </span>
</template>
