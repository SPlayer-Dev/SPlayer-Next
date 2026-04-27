<script setup lang="ts">
import type { Platform } from "@shared/types/platform";
import { useSortable } from "@vueuse/integrations/useSortable";
import { DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import { useSettingsStore } from "@/stores/settings";
import IconLucideGripVertical from "~icons/lucide/grip-vertical";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);

const list = ref<Platform[]>([]);
const listEl = ref<HTMLElement | null>(null);

watch(open, (val) => {
  if (val) list.value = [...settings.lyric.lyricSourceOrder];
});

useSortable(listEl, list, {
  animation: 150,
  forceFallback: true,
  watchElement: true,
  fallbackClass: "sortable-ghost",
});

const labelOf = (v: Platform): string =>
  ({
    netease: t("settings.lyricSourcePreference.netease"),
    qqmusic: t("settings.lyricSourcePreference.qqmusic"),
    kugou: t("settings.lyricSourcePreference.kugou"),
  })[v] ?? v;

const handleConfirm = () => {
  settings.lyric.lyricSourceOrder = [...list.value];
  open.value = false;
};

const handleReset = () => {
  list.value = [...DEFAULT_LYRIC_SOURCE_ORDER];
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("settings.lyricSourceOrder.button") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.lyricSourceOrder.label')"
    :description="t('settings.lyricSourceOrder.hint')"
    width="420px"
  >
    <div ref="listEl" class="flex flex-col gap-2.5">
      <SCard
        v-for="(item, idx) in list"
        :key="item"
        class="flex items-center gap-3 cursor-grab active:cursor-grabbing"
      >
        <span class="w-5 text-center text-xs text-on-surface-variant/60 font-medium">
          {{ idx + 1 }}
        </span>
        <span class="text-sm flex-1">{{ labelOf(item) }}</span>
        <IconLucideGripVertical class="text-on-surface-variant/40" />
      </SCard>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="handleReset">{{ t("common.reset") }}</SButton>
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="handleConfirm">{{ t("common.confirm") }}</SButton>
    </template>
  </SDialog>
</template>
