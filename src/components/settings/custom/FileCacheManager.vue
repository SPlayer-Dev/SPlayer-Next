<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { formatFileSize } from "@/utils/format";
import type { Component } from "vue";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideImage from "~icons/lucide/image";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideImagePlus from "~icons/lucide/image-plus";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDatabase from "~icons/lucide/database";
import { useCacheStats } from "@/composables/useCacheStats";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const { stats, cacheDir, loading, clearingId, clearingKind, refresh, setCacheDir } =
  useCacheStats();

const iconMap: Record<string, Component> = {
  covers: IconLucideImage,
  artists: IconLucideUserRound,
  backgrounds: IconLucideImagePlus,
  songs: IconLucideMusic,
};

const fileStats = computed(() => stats.value.filter((stat) => stat.kind === "file"));
const totalSize = computed(() => fileStats.value.reduce((sum, stat) => sum + stat.size, 0));

onMounted(() => {
  if (stats.value.length === 0) void refresh();
});

const handlePickDir = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.cacheDir.switchConfirmTitle"),
    content: t("settings.cacheDir.switchConfirmDesc"),
    type: "warning",
    confirmText: t("settings.cacheDir.switchConfirmOk"),
  });
  if (!confirmed) return;
  const result = await window.api.cache.pickDir();
  if (!result.ok) {
    if (result.reason === "notEmpty") toast.error(t("settings.cacheDir.notEmpty"));
    return;
  }
  setCacheDir(result.dir);
  await refresh();
  toast.success(t("settings.cacheDir.changedHint"));
};

const handleResetDir = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.cacheDir.resetConfirmTitle"),
    content: t("settings.cacheDir.resetConfirmDesc"),
    type: "warning",
  });
  if (!confirmed) return;
  setCacheDir(await window.api.cache.resetDir());
  await refresh();
};

const handleOpenDir = (): void => {
  if (cacheDir.value) void window.api.system.showInExplorer(cacheDir.value);
};

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
    title: t("settings.fileClearAll.confirmTitle"),
    content: t("settings.fileClearAll.confirmDesc"),
    type: "error",
  });
  if (!confirmed) return;
  clearingKind.value = "file";
  try {
    await window.api.cache.clearAllByKind("file");
    await refresh();
  } finally {
    clearingKind.value = null;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 缓存目录 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t("settings.cacheDir.label") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5 truncate font-mono" :title="cacheDir">
          {{ cacheDir || "—" }}
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <SButton variant="ghost" circle :title="t('settings.cacheDir.open')" @click="handleOpenDir">
          <template #icon><IconLucideFolderOpen /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
          :title="t('settings.cacheDir.reset')"
          @click="handleResetDir"
        >
          <template #icon><IconLucideRotateCcw /></template>
        </SButton>
        <SButton variant="secondary" @click="handlePickDir">
          {{ t("settings.cacheDir.change") }}
        </SButton>
      </div>
    </div>

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
        <template v-for="(stat, idx) in fileStats" :key="stat.id">
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
          <SDivider v-if="idx < fileStats.length - 1" />
        </template>
      </div>
    </div>

    <!-- 一键清空 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t("settings.fileClearAll.label") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.fileClearAll.description") }}
        </div>
      </div>
      <SButton
        type="error"
        variant="secondary"
        :loading="clearingKind === 'file'"
        :disabled="totalSize === 0"
        @click="requestClearAll"
      >
        {{ t("settings.fileClearAll.button") }}
      </SButton>
    </div>
  </div>
</template>
