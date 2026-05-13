<script setup lang="ts">
import { dialog } from "@/composables/useDialog";
import { formatFileSize } from "@/utils/format";
import type { Component } from "vue";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMic2 from "~icons/lucide/mic-2";
import IconLucideFileText from "~icons/lucide/file-text";
import IconLucideSearch from "~icons/lucide/search";
import IconLucideDatabase from "~icons/lucide/database";
import { useCacheStats } from "@/composables/useCacheStats";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const { stats, loading, clearingId, clearingKind, refresh } = useCacheStats();

const iconMap: Record<string, Component> = {
  lyric: IconLucideMic2,
  lyricTTML: IconLucideFileText,
  lyricMatch: IconLucideSearch,
};

const dbStats = computed(() => stats.value.filter((stat) => stat.kind === "db"));
const totalSize = computed(() => dbStats.value.reduce((sum, stat) => sum + stat.size, 0));

onMounted(() => {
  if (stats.value.length === 0) void refresh();
});

const requestClear = async (id: string): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.cacheCategoryClear.confirmTitle", {
      name: t(`settings.cacheCategory.${id}`),
    }),
    content: t("settings.cacheCategoryClear.confirmDesc"),
    type: "warning",
  });
  if (!confirmed) return;
  clearingId.value = id;
  try {
    await window.api.cache.clear(id);
    await refresh();
  } finally {
    clearingId.value = null;
  }
};

const requestClearAll = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.dbClearAll.confirmTitle"),
    content: t("settings.dbClearAll.confirmDesc"),
    type: "error",
  });
  if (!confirmed) return;
  clearingKind.value = "db";
  try {
    await window.api.cache.clearAllByKind("db");
    await refresh();
  } finally {
    clearingKind.value = null;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 占用情况 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 overflow-hidden"
    >
      <div class="px-4 py-2.5 flex items-center gap-3 text-sm">
        <span class="flex-1 text-on-surface-variant/80">
          {{ t("settings.cacheUsage.label") }}
        </span>
        <span class="text-on-surface-variant/60">
          {{ t("settings.cacheUsage.total") }}：
          <span class="text-on-surface tabular-nums">{{ formatFileSize(totalSize) }}</span>
        </span>
        <SButton
          variant="ghost"
          circle
          :loading="loading"
          :title="t('settings.cacheUsage.refresh')"
          @click="refresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
        </SButton>
      </div>
      <SDivider />
      <div class="flex flex-col">
        <template v-for="(stat, idx) in dbStats" :key="stat.id">
          <div class="px-4 py-2.5 flex items-center gap-3">
            <component
              :is="iconMap[stat.id] ?? IconLucideDatabase"
              class="size-4 shrink-0 text-on-surface-variant"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm">{{ t(`settings.cacheCategory.${stat.id}`) }}</div>
              <div class="text-xs text-on-surface-variant/60 truncate font-mono" :title="stat.path">
                {{ stat.path }}
              </div>
            </div>
            <div class="shrink-0 w-24 text-right text-sm text-on-surface-variant tabular-nums">
              {{ formatFileSize(stat.size) }}
            </div>
            <SButton
              variant="ghost"
              circle
              :loading="clearingId === stat.id"
              :disabled="stat.size === 0"
              :title="t('settings.cacheCategoryClear.label')"
              @click="requestClear(stat.id)"
            >
              <template #icon><IconLucideTrash2 /></template>
            </SButton>
          </div>
          <SDivider v-if="idx < dbStats.length - 1" />
        </template>
      </div>
    </div>

    <!-- 一键清空 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t("settings.dbClearAll.label") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.dbClearAll.description") }}
        </div>
      </div>
      <SButton
        type="error"
        variant="secondary"
        :loading="clearingKind === 'db'"
        :disabled="totalSize === 0"
        @click="requestClearAll"
      >
        {{ t("settings.dbClearAll.button") }}
      </SButton>
    </div>
  </div>
</template>
