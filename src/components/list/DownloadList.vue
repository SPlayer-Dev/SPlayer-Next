<script setup lang="ts">
import type { DownloadTask, DownloadStatus } from "@shared/types/download";
import type { Track } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useDownloadStore } from "@/stores/download";
import { useDownload } from "@/composables/useDownload";
import { dialog } from "@/composables/useDialog";
import { isLosslessQuality, getQualityLabel } from "@/utils/quality";
import { formatTime } from "@/utils/time";
import { formatFileSize } from "@/utils/format";
import * as player from "@/core/player";
import IconLucideLoaderCircle from "~icons/lucide/loader-circle";
import IconLucideDownload from "~icons/lucide/download";
import IconLucidePlay from "~icons/lucide/play";
import IconLucidePause from "~icons/lucide/pause";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideX from "~icons/lucide/x";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideTriangleAlert from "~icons/lucide/triangle-alert";
import IconLucideFolderOpen from "~icons/lucide/folder-open";

const props = defineProps<{
  /** 当前 tab 已过滤好的下载任务 */
  tasks: DownloadTask[];
}>();

const { t } = useI18n();
const media = useMediaStore();
const status = useStatusStore();
const downloadStore = useDownloadStore();
const { retry } = useDownload();

const STATUS_KEY: Record<DownloadStatus, string> = {
  queued: "download.status.queued",
  downloading: "download.status.downloading",
  done: "download.status.done",
  failed: "download.status.failed",
  canceled: "download.status.canceled",
  interrupted: "download.status.interrupted",
};

const isError = (taskStatus: DownloadStatus): boolean =>
  taskStatus === "failed" || taskStatus === "canceled" || taskStatus === "interrupted";

/** 已完成且文件就绪（可播放） */
const isDone = (task: DownloadTask): boolean => task.status === "done" && !!task.filePath;

const percent = (task: DownloadTask): number =>
  task.total > 0 ? Math.min(100, Math.round((task.received / task.total) * 100)) : 0;

const artistText = (task: DownloadTask): string =>
  task.track.artists.map((artist) => artist.name).join(" / ");

/** 文件大小文本（已知字节才显示） */
const sizeText = (task: DownloadTask): string => {
  const bytes = task.total || task.received;
  return bytes > 0 ? formatFileSize(bytes) : "";
};

/** 已完成任务 → 可播本地 Track（播放下载下来的文件而非重新联网） */
const toLocalTrack = (task: DownloadTask): Track => ({
  ...task.track,
  source: "local",
  path: task.filePath,
  id: task.filePath!,
});

/** 可播放队列（已完成且有文件） */
const playableTasks = computed(() => props.tasks.filter(isDone));

/** 当前播放的是否为该任务 */
const isPlaying = (task: DownloadTask): boolean =>
  isDone(task) && media.track?.id === task.filePath;

/** 在可播放队列中定位并播放 */
const playTask = (task: DownloadTask): void => {
  const index = playableTasks.value.findIndex((item) => item.taskId === task.taskId);
  if (index >= 0) void player.playFrom(playableTasks.value.map(toLocalTrack), index);
};

/** 序号位点击：正在播放则切换，否则播放 */
const onIndexClick = (task: DownloadTask): void => {
  if (!isDone(task)) return;
  if (isPlaying(task)) player.togglePlay();
  else playTask(task);
};

const rowClass = (task: DownloadTask): string => {
  if (isPlaying(task)) return "bg-primary/16 border-primary/40";
  const base = "bg-surface-panel border-primary/12";
  if (isDone(task)) {
    return `${base} cursor-pointer hover:border-primary/30 hover:bg-on-surface/8 active:bg-on-surface/12`;
  }
  return base;
};

/** 在文件管理器中定位下载的文件 */
const openFolder = (task: DownloadTask): void => {
  if (task.filePath) window.api.system.showInExplorer(task.filePath);
};

/** 二次确认后删除已下载的本地文件并移除记录 */
const confirmDelete = async (task: DownloadTask): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("download.deleteConfirmTitle"),
    content: t("download.deleteConfirmContent"),
    type: "warning",
  });
  if (confirmed) downloadStore.remove(task.taskId);
};

/** 播放全部已完成（供下载页顶栏调用） */
const playAll = (): void => {
  if (playableTasks.value.length > 0) {
    void player.playFrom(playableTasks.value.map(toLocalTrack), 0);
  }
};

defineExpose({ playAll });
</script>

<template>
  <SVirtualList
    :items="tasks"
    :item-height="88"
    :get-item-key="(task: DownloadTask) => task.taskId"
    item-fixed
    height="100%"
    :padding-bottom="80"
  >
    <!-- 固定表头 -->
    <template #header>
      <div class="pr-1.5">
        <div class="flex items-center gap-3 pl-3 pr-6 mx-3 h-10 text-sm text-on-surface-variant/60">
          <div class="w-8 shrink-0 flex items-center justify-center"><span>#</span></div>
          <div class="flex-1 min-w-0 px-1.5">{{ t("songList.title") }}</div>
          <div class="shrink-0 text-center text-xs leading-6" style="min-width: fit-content">
            {{ t("download.colStatus") }}
          </div>
          <div class="shrink-0 text-center text-xs leading-6" style="min-width: fit-content">
            {{ t("download.colSize") }}
          </div>
          <div class="shrink-0 text-center text-xs leading-6" style="min-width: fit-content">
            {{ t("songList.duration") }}
          </div>
          <div class="shrink-0 text-center text-xs leading-6" style="min-width: fit-content">
            {{ t("songList.actions") }}
          </div>
        </div>
      </div>
    </template>
    <!-- 列表项 -->
    <template #default="{ item, index }: { item: DownloadTask; index: number }">
      <div class="px-3 pb-3">
        <div
          class="group flex items-center gap-3 pl-3 pr-6 h-19 rounded-xl border-2 border-solid transition-[background-color,border-color] duration-200"
          :class="rowClass(item)"
          @dblclick="isDone(item) ? playTask(item) : undefined"
        >
          <!-- 序号 / 状态图标 -->
          <div
            class="w-8 shrink-0 flex items-center justify-center relative"
            :class="isPlaying(item) ? 'text-primary' : 'text-on-surface-variant'"
            @click.stop="onIndexClick(item)"
          >
            <template v-if="isDone(item)">
              <span
                v-if="!isPlaying(item)"
                class="text-sm font-bold tabular-nums group-hover:opacity-0 transition-opacity duration-300"
              >
                {{ index + 1 }}
              </span>
              <IconLucideMusic
                v-else
                class="size-5 group-hover:opacity-0 transition-opacity duration-300"
              />
              <div
                class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-300 group-hover:scale-100 scale-80 cursor-pointer"
              >
                <IconLucidePause v-if="isPlaying(item) && status.isPlaying" class="size-5" />
                <IconLucidePlay v-else class="size-5" />
              </div>
            </template>
            <template v-else>
              <IconLucideLoaderCircle
                v-if="item.status === 'downloading'"
                class="size-4 animate-spin"
              />
              <IconLucideDownload v-else class="size-4" />
            </template>
          </div>
          <!-- 信息 -->
          <div class="flex-1 min-w-0 flex items-center gap-3">
            <SImg :src="item.track.cover" class="size-12 rounded-lg shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-1.5 min-w-0">
                <span
                  class="text-base font-medium truncate"
                  :class="isPlaying(item) ? 'text-primary' : ''"
                >
                  {{ item.track.title }}
                </span>
                <IconLucideTriangleAlert
                  v-if="item.tagWarning"
                  class="size-3.5 shrink-0 self-center text-amber-500"
                  :title="t('download.tagWarning')"
                />
              </div>
              <div
                class="text-sm mt-1 truncate flex items-center gap-1"
                :class="isPlaying(item) ? 'text-primary/70' : 'text-on-surface-variant'"
              >
                <span
                  v-if="item.track.quality"
                  class="shrink-0 px-1 rounded text-[10px] leading-[18px] font-bold border border-solid"
                  :class="
                    isLosslessQuality(item.track.quality)
                      ? 'text-amber-500 border-amber-500/40'
                      : 'text-on-surface-variant border-on-surface-variant/40'
                  "
                >
                  {{ getQualityLabel(item.track.quality) }}
                </span>
                <span class="truncate">{{ artistText(item) }}</span>
              </div>
            </div>
          </div>
          <!-- 进度 / 状态 -->
          <div class="w-32 shrink-0">
            <div v-if="item.status === 'downloading'" class="flex flex-col gap-1.5">
              <div class="h-1.5 w-full rounded-full bg-on-surface/10 overflow-hidden">
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-200"
                  :style="{ width: `${percent(item)}%` }"
                />
              </div>
              <span class="text-xs text-on-surface-variant/60 tabular-nums text-left">
                {{ percent(item) }}%
              </span>
            </div>
            <span v-else class="text-sm text-on-surface-variant/60">
              {{ t(STATUS_KEY[item.status]) }}
            </span>
          </div>
          <!-- 大小 -->
          <div class="w-20 shrink-0 text-center text-sm tabular-nums text-on-surface-variant">
            {{ sizeText(item) || "—" }}
          </div>
          <!-- 时长 -->
          <div
            class="w-16 shrink-0 text-center text-sm tabular-nums"
            :class="isPlaying(item) ? 'text-primary/60' : 'text-on-surface-variant'"
          >
            {{ item.track.duration ? formatTime(item.track.duration) : "—" }}
          </div>
          <!-- 操作 -->
          <div class="w-20 shrink-0 flex items-center justify-center gap-1" @click.stop>
            <SButton
              v-if="item.status === 'queued' || item.status === 'downloading'"
              variant="ghost"
              circle
              size="small"
              :title="t('download.cancel')"
              @click="downloadStore.cancel(item.taskId)"
            >
              <template #icon><IconLucideX /></template>
            </SButton>
            <template v-else-if="isError(item.status)">
              <SButton
                variant="ghost"
                circle
                size="small"
                :title="t('download.retry')"
                @click="retry(item)"
              >
                <template #icon><IconLucideRotateCcw /></template>
              </SButton>
              <SButton
                variant="ghost"
                circle
                size="small"
                :title="t('download.remove')"
                @click="downloadStore.remove(item.taskId)"
              >
                <template #icon><IconLucideTrash2 /></template>
              </SButton>
            </template>
            <template v-else-if="isDone(item)">
              <SButton
                variant="ghost"
                circle
                size="small"
                :title="t('download.openFolder')"
                @click="openFolder(item)"
              >
                <template #icon><IconLucideFolderOpen /></template>
              </SButton>
              <SButton
                variant="ghost"
                circle
                size="small"
                :title="t('download.deleteFile')"
                @click="confirmDelete(item)"
              >
                <template #icon><IconLucideTrash2 /></template>
              </SButton>
            </template>
          </div>
        </div>
      </div>
    </template>
  </SVirtualList>
</template>
