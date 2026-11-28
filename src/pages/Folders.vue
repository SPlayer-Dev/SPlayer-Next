<script setup lang="ts">
defineOptions({ name: "Folders" });

import type { Track } from "@shared/types/player";
import type { FolderNode } from "@/types/folder";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlaylistStore } from "@/stores/playlist";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideChevronRight from "~icons/lucide/chevron-right";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideListPlus from "~icons/lucide/list-plus";
import IconLucideEllipsis from "~icons/lucide/ellipsis";

const { t } = useI18n();
const router = useRouter();
const libraryStore = useLibraryStore();
const playlistStore = usePlaylistStore();
const settingsStore = useSettingsStore();
const { tracks, initialized, folderTree, folderCount } = storeToRefs(libraryStore);

const TREE_DEFAULT_WIDTH = 256;
const TREE_MIN_WIDTH = 200;
const TREE_MAX_WIDTH = 640;

// 拖拽过程只改本地宽度，松手再写入设置，避免每帧触发持久化
const treeWidth = ref(settingsStore.appearance.folderTreeWidth);
const resizing = ref(false);

/**
 * 拖拽分隔条调整目录树宽度
 * @param event - 分隔条上的 pointerdown 事件
 */
const handleResizeStart = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = treeWidth.value;
  resizing.value = true;
  const onMove = (e: PointerEvent): void => {
    const next = startWidth + e.clientX - startX;
    treeWidth.value = Math.round(Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, next)));
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener(
    "lostpointercapture",
    () => {
      handle.removeEventListener("pointermove", onMove);
      resizing.value = false;
      settingsStore.appearance.folderTreeWidth = treeWidth.value;
    },
    { once: true },
  );
};

/** 双击分隔条恢复默认宽度 */
const handleResizeReset = (): void => {
  treeWidth.value = TREE_DEFAULT_WIDTH;
  settingsStore.appearance.folderTreeWidth = TREE_DEFAULT_WIDTH;
};

const trackCount = computed(() => tracks.value.filter((tr) => !!tr.path).length);

const expanded = ref<string[]>([]);
const selectedFolder = shallowRef<FolderNode | null>(null);
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);
const createOpen = ref(false);

/** 更多操作菜单 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "createPlaylist",
    label: t("collection.create", { type: t("collection.playlist") }),
    icon: IconLucideListPlus,
  },
  { key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks },
]);

/** 处理更多操作 */
const handleMore = (key: string): void => {
  if (key === "createPlaylist") createOpen.value = true;
  else if (key === "batchManage") songListRef.value?.enterBatch();
};

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

const selectedTracks = computed<Track[]>(() => {
  const folder = selectedFolder.value;
  return folder ? toRaw(folder.tracks) : [];
});

const handlePlayAll = (): void => {
  if (selectedTracks.value.length === 0) return;
  player.playFrom(selectedTracks.value);
};

/** 文件夹创建为本地歌单 */
const handleCreated = async (playlistId: string): Promise<void> => {
  const count = await playlistStore.addTracks(playlistId, selectedTracks.value);
  toast.success(t("collection.tracksAdded", { count }));
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
        <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("folder.label") }}</h1>
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
    <div
      v-if="folderTree.length > 0"
      class="flex-1 min-h-0 flex"
      :class="resizing ? 'cursor-col-resize select-none' : ''"
    >
      <!-- 文件夹树 -->
      <div
        class="shrink-0 max-w-[50%] bg-surface-panel border border-solid border-primary/12 rounded-xl ml-3 mb-3 overflow-hidden"
        :style="{ width: treeWidth + 'px' }"
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
            <span class="flex-1 min-w-0 truncate text-sm" :title="node.name">{{ node.name }}</span>
            <span class="shrink-0 text-xs text-on-surface-variant/50 tabular-nums">
              {{ node.tracks.length }}
            </span>
          </template>
        </STree>
      </div>
      <!-- 宽度调整分隔条，占据目录树与列表之间的间隙 -->
      <div class="relative w-0 shrink-0 mb-3">
        <div
          role="separator"
          aria-orientation="vertical"
          class="group absolute inset-y-0 left-0 z-10 w-3 flex justify-center cursor-col-resize touch-none"
          @pointerdown="handleResizeStart"
          @dblclick="handleResizeReset"
        >
          <div
            class="w-0.5 h-full rounded-full transition-colors duration-150"
            :class="resizing ? 'bg-primary/60' : 'group-hover:bg-primary/30'"
          />
        </div>
      </div>
      <!-- 歌曲列表 -->
      <div class="flex-1 min-w-0">
        <SongList
          v-if="selectedFolder && selectedTracks.length > 0"
          ref="songListRef"
          :items="selectedTracks"
          show-album
          show-duration
          sort-key="folders"
          enable-sort
        >
          <template #topInfo>
            <div
              class="mx-3 mb-2 flex items-center gap-2 pl-3 pr-6 py-3 bg-surface-panel border-2 border-solid border-primary/12 rounded-xl"
            >
              <SButton
                type="primary"
                variant="secondary"
                size="small"
                round
                :disabled="selectedTracks.length === 0"
                @click="handlePlayAll"
              >
                <template #icon><IconLucidePlay /></template>
                {{ t("common.playAll") }}
              </SButton>
              <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMore">
                <template #trigger>
                  <SButton
                    variant="secondary"
                    circle
                    size="small"
                    :disabled="selectedTracks.length === 0"
                  >
                    <template #icon><IconLucideEllipsis /></template>
                  </SButton>
                </template>
              </SDropdownMenu>
              <SDivider vertical class="h-6 mx-1" />
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
    <PlaylistCreateDialog
      v-model:open="createOpen"
      mode="local"
      :initial-name="selectedFolder?.name"
      @created="handleCreated"
    />
  </div>
</template>
