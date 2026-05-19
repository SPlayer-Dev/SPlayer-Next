import type { Ref } from "vue";
import type { Track, TrackSource } from "@shared/types/player";
import type { CollectionType } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useLibraryStore } from "@/stores/library";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";

export interface MultiSelectOptions {
  /** 列表来源 */
  source: Ref<TrackSource | undefined>;
  /** 集合类型 */
  collectionType: Ref<CollectionType | undefined>;
  /** 集合 ID */
  collectionId: Ref<string | undefined>;
  /**
   * 删除/移除完成后的回调
   * @param removedIds 成功删除的曲目 id 列表
   */
  onChanged?: (removedIds: string[]) => void;
}

/**
 * 歌曲列表多选 + 批量操作
 */
export const useMultiSelect = (items: Ref<Track[]>, options: MultiSelectOptions) => {
  const { t } = useI18n();
  const playlistStore = usePlaylistStore();
  const libraryStore = useLibraryStore();
  const userStore = useUserStore();

  const active = ref(false);
  const selectedIds = ref(new Set<string>());

  const selectedCount = computed(() => selectedIds.value.size);
  const isAllSelected = computed(
    () => items.value.length > 0 && selectedIds.value.size === items.value.length,
  );
  const isPartial = computed(
    () => selectedIds.value.size > 0 && selectedIds.value.size < items.value.length,
  );
  const selectedItems = computed(() =>
    items.value.filter((item) => selectedIds.value.has(item.id)),
  );

  const toggle = (id: string): void => {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  };

  const selectAll = (): void => {
    selectedIds.value = new Set(items.value.map((t) => t.id));
  };

  const invertSelection = (): void => {
    const next = new Set<string>();
    for (const item of items.value) {
      if (!selectedIds.value.has(item.id)) next.add(item.id);
    }
    selectedIds.value = next;
  };

  const clear = (): void => {
    selectedIds.value = new Set();
  };

  const enter = (): void => {
    active.value = true;
    clear();
  };

  const exit = (): void => {
    active.value = false;
    clear();
  };

  const toggleSelectAll = (): void => {
    if (isAllSelected.value) clear();
    else selectAll();
  };

  const canRemove = computed(() => options.collectionType.value === "playlist");
  const canRemoveFromCloud = computed(() => options.collectionType.value === "cloud");

  const collectionTypeLabel = computed(() => {
    const map: Record<string, string> = {
      playlist: t("collection.playlist"),
      album: t("collection.album"),
      radio: t("collection.radio"),
    };
    return options.collectionType.value ? (map[options.collectionType.value] ?? "") : "";
  });

  type DeleteAction = "remove" | "file" | "cloud";
  const deleteConfirmOpen = ref(false);
  const pendingDeleteTracks = shallowRef<Track[]>([]);
  const pendingDeleteAction = ref<DeleteAction>("remove");

  const requestDelete = (tracks: Track[], action: DeleteAction): void => {
    if (tracks.length === 0) return;
    pendingDeleteTracks.value = tracks;
    pendingDeleteAction.value = action;
    deleteConfirmOpen.value = true;
  };

  const confirmDelete = async (): Promise<void> => {
    const tracks = pendingDeleteTracks.value;
    const ids = tracks.map((track) => track.id);
    try {
      if (pendingDeleteAction.value === "file") {
        const paths = tracks.map((t) => t.path).filter((p): p is string => !!p);
        if (paths.length > 0) await libraryStore.deleteTracks(paths);
      } else if (pendingDeleteAction.value === "cloud") {
        await userStore.removeCloudTracks(ids);
      } else if (options.collectionId.value) {
        if (options.source.value === "local") {
          await playlistStore.removeTracks(options.collectionId.value, ids);
        } else if (options.source.value === "netease") {
          await userStore.removeTracksFromPlaylist(options.collectionId.value, ids);
        }
      }
      deleteConfirmOpen.value = false;
      exit();
      options.onChanged?.(ids);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
      toast.error(message);
    }
  };

  const cancelDelete = (): void => {
    deleteConfirmOpen.value = false;
  };

  /** 确认弹窗标题 */
  const deleteDialogTitle = computed(() => {
    if (pendingDeleteAction.value === "file") return t("songList.delete.fileTitle");
    if (pendingDeleteAction.value === "cloud") return t("cloud.removeTitle");
    return t("collection.removeFrom", { type: collectionTypeLabel.value });
  });

  /** 确认弹窗内容 */
  const deleteDialogContent = computed(() => {
    const count = pendingDeleteTracks.value.length;
    const type = collectionTypeLabel.value;
    if (count === 1) {
      const title = pendingDeleteTracks.value[0].title;
      if (pendingDeleteAction.value === "file") {
        return t("songList.delete.fileConfirmOne", { title });
      }
      if (pendingDeleteAction.value === "cloud") {
        return t("cloud.removeConfirmOne", { title });
      }
      return t("songList.delete.removeConfirmOne", { title, type });
    }
    if (pendingDeleteAction.value === "file") return t("songList.delete.fileConfirm", { count });
    if (pendingDeleteAction.value === "cloud") return t("cloud.removeConfirm", { count });
    return t("songList.delete.removeConfirm", { count, type });
  });

  const addToQueue = (): void => {
    const tracks = selectedItems.value;
    if (tracks.length === 0) return;
    for (const track of tracks) {
      player.insertToQueue(track);
    }
    exit();
  };

  const batchRemove = (): void => {
    requestDelete(selectedItems.value, "remove");
  };

  const batchDelete = (): void => {
    requestDelete(selectedItems.value, "file");
  };

  const batchRemoveFromCloud = (): void => {
    requestDelete(selectedItems.value, "cloud");
  };

  return {
    // 选择状态
    active,
    selectedIds,
    selectedCount,
    isAllSelected,
    isPartial,
    selectedItems,
    toggle,
    selectAll,
    invertSelection,
    clear,
    enter,
    exit,
    toggleSelectAll,
    // 集合信息
    canRemove,
    canRemoveFromCloud,
    collectionTypeLabel,
    // 删除弹窗
    deleteConfirmOpen,
    deleteDialogTitle,
    deleteDialogContent,
    requestDelete,
    confirmDelete,
    cancelDelete,
    // 批量操作
    addToQueue,
    batchRemove,
    batchDelete,
    batchRemoveFromCloud,
  };
};
