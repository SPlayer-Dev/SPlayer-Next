import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Track } from "@shared/types/player";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { clearQueue, queue, queueLength } from "@/stores/queue";
import * as player from "@/core/player";

export interface UseQueuePanelOptions {
  listRef: Ref<SVirtualListExposed | null>;
}

/**
 * 播放队列面板的共享逻辑（与拖排序解耦）
 * 视觉表达交给具体组件，这里只管：播放、移除、清空、定位
 * 拖排序按需在 consumer 里直接调 useDragSort，避免不需要的组件白付出 ref/closure 开销
 */
export const useQueuePanel = (options: UseQueuePanelOptions) => {
  const { t } = useI18n();
  const statusStore = useStatusStore();
  const mediaStore = useMediaStore();

  /** 拼接艺术家名称 */
  const formatArtists = (artists: Track["artists"]): string => {
    if (!artists?.length) return t("playlist.unknownArtist");
    return artists.map((ar) => ar.name).join(" / ");
  };

  /** 播放指定索引；是否关闭面板交给调用方决定 */
  const playAt = async (index: number): Promise<void> => {
    await player.playAtIndex(index);
  };

  /** 移除单首 */
  const removeAt = (index: number): void => {
    player.removeFromQueue(index);
  };

  const clearConfirmOpen = ref(false);

  /** 清空队列 + 重置播放索引 */
  const clearAll = (): void => {
    if (queueLength.value === 0) return;
    player.stop();
    statusStore.playIndex = -1;
    clearQueue();
    mediaStore.clear();
    useThemeStore().coverColor = null;
    clearConfirmOpen.value = false;
  };

  /** 滚动到当前正在播放项 */
  const scrollToCurrent = (): void => {
    if (statusStore.playIndex >= 0) {
      options.listRef.value?.scrollToIndex(statusStore.playIndex);
    }
  };

  return {
    statusStore,
    queue,
    queueLength,
    formatArtists,
    playAt,
    removeAt,
    clearConfirmOpen,
    clearAll,
    scrollToCurrent,
  };
};
