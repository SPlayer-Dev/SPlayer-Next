<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { FolderNode } from "@/types/folder";
import { useLibraryStore } from "@/stores/library";
import * as player from "@/core/player";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideChevronRight from "~icons/lucide/chevron-right";
import IconLucidePlay from "~icons/lucide/play";

const { t } = useI18n();
const router = useRouter();
const libraryStore = useLibraryStore();
const { tracks, initialized, folderTree, folderCount } = storeToRefs(libraryStore);

const trackCount = computed(() => tracks.value.filter((tr) => !!tr.path).length);

const expanded = ref<string[]>([]);
const selectedFolder = ref<FolderNode | null>(null);

// 默认展开/选中只在首次拿到非空树时执行一次，之后用户的折叠/选择不再被覆盖
let defaultsApplied = false;

const findFolder = (nodes: FolderNode[], path: string): FolderNode | null => {
  for (const node of nodes) {
    if (node.path === path) return node;
    const hit = findFolder(node.children, path);
    if (hit) return hit;
  }
  return null;
};

watch(
  [folderTree, initialized],
  ([current, init]) => {
    if (current.length === 0) {
      selectedFolder.value = null;
      defaultsApplied = false;
      return;
    }
    if (!defaultsApplied && init) {
      expanded.value = current.map((root) => root.path);
      selectedFolder.value = current[0];
      defaultsApplied = true;
      return;
    }
    /** 树结构变了，按 path 重新定位选中项 */
    if (selectedFolder.value) {
      const same = findFolder(current, selectedFolder.value.path);
      if (!same) selectedFolder.value = current[0];
      else if (same !== selectedFolder.value) selectedFolder.value = same;
    } else if (init) {
      selectedFolder.value = current[0];
    }
  },
  { immediate: true },
);

const selectedTracks = computed<Track[]>(() => selectedFolder.value?.tracks ?? []);

const handlePlayAll = (): void => {
  if (selectedTracks.value.length === 0) return;
  player.playFrom(selectedTracks.value, 0);
};

const getKey = (node: FolderNode): string => node.path;
const getChildren = (node: FolderNode): FolderNode[] | undefined =>
  node.children.length > 0 ? node.children : undefined;

onMounted(async () => {
  if (!initialized.value) await libraryStore.load();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-baseline gap-4 mt-2 mb-4">
        <h1 class="text-3xl font-bold text-on-surface">{{ t("folder.label") }}</h1>
        <div
          v-if="trackCount > 0"
          class="flex items-center gap-3 text-sm text-on-surface-variant/50"
        >
          <span class="flex items-center gap-1">
            <IconLucideFolder class="size-3.5" />
            {{ t("folder.totalFolders", { count: folderCount }) }}
          </span>
          <span class="flex items-center gap-1">
            <IconLucideMusic class="size-3.5" />
            {{ t("common.totalSongs", { count: trackCount }) }}
          </span>
        </div>
      </div>
    </div>
    <div v-if="folderTree.length > 0" class="flex-1 min-h-0 flex">
      <!-- 文件夹树 -->
      <div
        class="w-64 shrink-0 overflow-y-auto bg-surface-panel border border-solid border-primary/12 rounded-xl ml-3 mb-3 p-2"
      >
        <STree
          v-model="selectedFolder"
          v-model:expanded="expanded"
          :items="folderTree"
          :get-key="getKey"
          :get-children="getChildren"
          :indent="16"
        >
          <template #node="{ node, isExpanded, hasChildren }">
            <IconLucideChevronRight
              v-if="hasChildren"
              class="size-4 shrink-0 text-on-surface-variant/70 transition-transform duration-200"
              :class="isExpanded ? 'rotate-90' : ''"
            />
            <span v-else class="size-4 shrink-0" />
            <component
              :is="isExpanded && hasChildren ? IconLucideFolderOpen : IconLucideFolder"
              class="size-4 shrink-0"
            />
            <span class="flex-1 min-w-0 truncate text-sm">{{ node.name }}</span>
            <span class="shrink-0 text-xs text-on-surface-variant/50 tabular-nums">
              {{ node.tracks.length }}
            </span>
          </template>
        </STree>
      </div>
      <!-- 歌曲列表（信息行通过 SongList 的 topInfo slot 渲染，与列宽自动对齐） -->
      <div class="flex-1 min-w-0">
        <SongList
          v-if="selectedFolder && selectedTracks.length > 0"
          :items="selectedTracks"
          show-album
          show-duration
        >
          <template #topInfo>
            <div
              class="mx-3 mb-2 flex items-center gap-3 px-3 py-3 bg-surface-panel border-2 border-solid border-primary/12 rounded-xl"
            >
              <SButton
                type="primary"
                variant="secondary"
                round
                size="small"
                :disabled="selectedTracks.length === 0"
                @click="handlePlayAll"
              >
                <template #icon><IconLucidePlay /></template>
                {{ t("common.playAll") }}
              </SButton>
              <SDivider vertical class="!h-5" />
              <IconLucideFolderOpen class="size-4 text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ selectedFolder.name }}</div>
                <div class="text-xs text-on-surface-variant/60 truncate">
                  {{ selectedFolder.path }}
                </div>
              </div>
              <span class="shrink-0 flex items-center gap-1 text-xs text-on-surface-variant/60">
                <IconLucideMusic class="size-3.5" />
                {{ t("common.totalSongs", { count: selectedTracks.length }) }}
              </span>
            </div>
          </template>
        </SongList>
        <div v-else class="h-full flex items-center justify-center">
          <div class="text-center text-on-surface-variant/50">
            <IconLucideMusic class="size-10 mx-auto mb-2 opacity-30" />
            <div class="text-sm">{{ t("common.noData") }}</div>
          </div>
        </div>
      </div>
    </div>
    <!-- 空状态 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideFolder class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("library.noLocalData") }}</div>
        <div class="text-xs mb-4 opacity-70">{{ t("library.noLocalDataHint") }}</div>
        <SButton type="primary" variant="secondary" @click="router.push('/library')">
          <template #icon><IconLucideMusic /></template>
          {{ t("library.goLibrary") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
