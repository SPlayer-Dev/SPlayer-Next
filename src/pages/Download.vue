<script setup lang="ts">
defineOptions({ name: "Download" });

import type { DownloadTask, DownloadStatus } from "@shared/types/download";
import type { TabItem } from "@/components/ui/STabs.vue";
import { useDownloadStore } from "@/stores/download";
import { dialog } from "@/composables/useDialog";
import DownloadList from "@/components/list/DownloadList.vue";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDownload from "~icons/lucide/download";

const { t } = useI18n();
const downloadStore = useDownloadStore();

type DownloadTab = "active" | "error" | "done";
const tab = ref<DownloadTab>("active");

const tabs = computed<TabItem[]>(() => [
  { key: "active", label: t("download.tabActive") },
  { key: "error", label: t("download.tabError") },
  { key: "done", label: t("download.tabDone") },
]);

const isError = (status: DownloadStatus): boolean =>
  status === "failed" || status === "canceled" || status === "interrupted";

/** 当前 tab 的任务 */
const currentTasks = computed<DownloadTask[]>(() => {
  if (tab.value === "active") return downloadStore.activeTasks;
  if (tab.value === "error")
    return downloadStore.historyTasks.filter((task) => isError(task.status));
  return downloadStore.historyTasks.filter((task) => task.status === "done");
});

/** 是否有可清空的已结束任务 */
const hasFinished = computed(() => downloadStore.historyTasks.length > 0);

/** 二次确认后清空已结束任务记录（不删本地文件） */
const requestClearFinished = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("download.clearConfirmTitle"),
    content: t("download.clearConfirmContent"),
    type: "warning",
  });
  if (confirmed) downloadStore.clearFinished();
};

const listRef = ref<InstanceType<typeof DownloadList> | null>(null);

const emptyText = computed(() =>
  tab.value === "done" ? t("download.emptyDone") : t("download.empty"),
);

onMounted(() => void downloadStore.init());
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-baseline gap-4 mt-2 mb-4 min-w-0">
        <h1 class="text-3xl font-bold text-on-surface shrink-0 text-balance">
          {{ t("download.title") }}
        </h1>
        <span class="flex items-center gap-1.5 text-sm text-on-surface-variant/50 shrink-0">
          <IconLucideMusic class="size-3.5" />
          {{ t("common.totalSongs", { count: currentTasks.length }) }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <STabs
          :model-value="tab"
          :tabs="tabs"
          type="bar"
          size="large"
          @update:model-value="(key) => (tab = key as DownloadTab)"
        />
        <div class="flex items-center gap-3 shrink-0">
          <SButton
            v-if="tab === 'done'"
            type="primary"
            variant="secondary"
            round
            :disabled="currentTasks.length === 0"
            @click="listRef?.playAll()"
          >
            <template #icon><IconLucidePlay /></template>
            {{ t("common.playAll") }}
          </SButton>
          <SButton variant="secondary" round :disabled="!hasFinished" @click="requestClearFinished">
            <template #icon><IconLucideTrash2 /></template>
            {{ t("download.clearFinished") }}
          </SButton>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="flex-1 min-h-0">
      <DownloadList v-if="currentTasks.length > 0" ref="listRef" :tasks="currentTasks" />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideDownload class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ emptyText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
