<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useLibraryStore } from "@/stores/library";
import { formatFileSize } from "@/utils/format";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import * as player from "@/core/player";

const { t } = useI18n();
const libraryStore = useLibraryStore();
const { tracks, scanDirs, scanning, scanProgress, initialized } = storeToRefs(libraryStore);

/** 搜索关键词 */
const searchQuery = ref("");

/** 所有歌曲的总文件大小 */
const totalSize = computed(() => {
  const bytes = tracks.value.reduce((sum, track) => sum + (track.fileSize ?? 0), 0);
  return bytes > 0 ? formatFileSize(bytes) : "";
});

// 截取目录名
const folderName = (dir: string): string => {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
};

// 添加文件夹
const handleAddFolder = async (): Promise<void> => {
  const res = await libraryStore.addScanDir();
  if (res.success) {
    // 新增目录后立即扫描
    libraryStore.startScan(false);
  }
};

// 移除文件夹确认
const removingDir = ref<string | null>(null);
const removeConfirmOpen = ref(false);
const confirmRemoveDir = (dir: string): void => {
  removingDir.value = dir;
  removeConfirmOpen.value = true;
};
const handleRemoveFolder = async (): Promise<void> => {
  if (!removingDir.value) return;
  await libraryStore.removeScanDir(removingDir.value);
  removeConfirmOpen.value = false;
};

// 播放全部
const handlePlayAll = (): void => {
  if (tracks.value.length === 0) return;
  player.playFrom(tracks.value, 0);
};

// 扫描进度百分比
const scanPercent = computed(() => {
  if (!scanProgress.value || scanProgress.value.total === 0) return 0;
  return Math.round((scanProgress.value.scanned / scanProgress.value.total) * 100);
});

// 目录管理弹窗
const folderDialogOpen = ref(false);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "folders", label: t("library.folders"), icon: IconFolderOpen },
  {
    key: "scan",
    label: scanning.value ? t("library.scanning") : t("library.scanAll"),
    icon: IconRefreshCw,
    disabled: scanning.value || scanDirs.value.length === 0,
  },
]);

// 更多菜单
const handleMoreMenu = (key: string): void => {
  switch (key) {
    // 目录管理
    case "folders":
      folderDialogOpen.value = true;
      break;
    // 全量扫描
    case "scan":
      libraryStore.startScan(false);
      break;
  }
};

// 进入页面时初始化
onMounted(async () => {
  libraryStore.subscribeScanProgress();
  if (!initialized.value) {
    await libraryStore.load();
  }
  // 有目录且有曲目时自动增量扫描
  if (scanDirs.value.length > 0 && tracks.value.length > 0) {
    libraryStore.startScan(true);
  }
});

onUnmounted(() => {
  libraryStore.unsubscribeScanProgress();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface">{{ t("library.title") }}</h1>
          <div
            v-if="tracks.length > 0"
            class="flex items-center gap-3 text-sm text-on-surface-variant/50"
          >
            <span class="flex items-center gap-1">
              <IconLucideMusic class="size-3.5" />
              {{ t("library.totalSongs", { count: tracks.length }) }}
            </span>
            <span v-if="totalSize" class="flex items-center gap-1">
              <IconLucideHardDrive class="size-3.5" />
              {{ totalSize }}
            </span>
          </div>
        </div>
        <!-- 扫描进度（轻量，不占高度） -->
        <Transition
          enter-active-class="transition-opacity duration-300"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-200"
          leave-to-class="opacity-0"
        >
          <div
            v-if="scanning && scanProgress"
            class="flex items-center gap-2 text-xs text-on-surface-variant/60"
          >
            <SLoading class="size-3.5 text-primary shrink-0" />
            <span class="tabular-nums">{{ scanProgress.scanned }}/{{ scanProgress.total }}</span>
            <span class="text-on-surface-variant/40">{{ scanPercent }}%</span>
          </div>
        </Transition>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="tracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("library.playAll") }}
          </SButton>
          <SButton
            variant="secondary"
            circle
            :disabled="scanning || scanDirs.length === 0"
            @click="libraryStore.startScan(true)"
          >
            <template #icon>
              <IconLucideRefreshCw :class="{ 'animate-spin': scanning }" />
            </template>
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle>
                <template #icon>
                  <IconLucideEllipsis />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
        <SInput
          v-model="searchQuery"
          :placeholder="t('common.search')"
          clearable
          round
          class="w-40 focus-within:w-56"
        >
          <template #prefix>
            <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
          </template>
        </SInput>
      </div>
    </div>
    <!-- 曲目列表 -->
    <div v-if="tracks.length > 0" class="flex-1 min-h-0">
      <SongList :items="tracks" :search-query="searchQuery" show-size />
    </div>
    <!-- 空状态：无目录或无歌曲 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("library.empty") }}</div>
        <div class="text-xs mb-4 opacity-70">{{ t("library.emptyHint") }}</div>
        <SButton type="primary" variant="secondary" @click="handleAddFolder">
          <template #icon><IconLucideFolderPlus /></template>
          {{ t("library.addFolder") }}
        </SButton>
      </div>
    </div>
    <!-- 文件夹管理 -->
    <SDialog
      v-model:open="folderDialogOpen"
      :title="t('library.folders')"
      :description="t('library.foldersDescription')"
      width="480px"
    >
      <div class="space-y-2">
        <!-- 目录列表 -->
        <div
          v-for="dir in scanDirs"
          :key="dir"
          class="flex items-center gap-3 px-3 py-2 rounded-lg bg-on-surface/4"
        >
          <IconLucideFolder class="size-4 text-on-surface-variant shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm truncate text-on-surface">{{ folderName(dir) }}</div>
            <div class="text-xs truncate text-on-surface-variant/60">{{ dir }}</div>
          </div>
          <SButton variant="ghost" size="small" @click="confirmRemoveDir(dir)">
            <template #icon><IconLucideTrash2 /></template>
          </SButton>
        </div>
        <!-- 空 -->
        <div
          v-if="scanDirs.length === 0"
          class="py-6 text-center text-on-surface-variant/50 text-sm"
        >
          {{ t("library.emptyHint") }}
        </div>
      </div>
      <template #footer>
        <SButton variant="secondary" @click="handleAddFolder">
          <template #icon><IconLucideFolderPlus /></template>
          {{ t("library.addFolder") }}
        </SButton>
      </template>
    </SDialog>
    <!-- 移除确认 -->
    <SDialog v-model:open="removeConfirmOpen" :title="t('library.removeFolder')">
      <template #default>
        <p class="text-sm text-on-surface-variant">{{ t("library.removeFolderConfirm") }}</p>
        <p class="text-xs text-on-surface-variant/60 mt-2 break-all">{{ removingDir }}</p>
      </template>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" @click="handleRemoveFolder">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
