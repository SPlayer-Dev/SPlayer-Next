import type { PlaybackOriginType, TrackSource } from "@shared/types/player";
import type { Collection } from "@/types/collection";
import type { CoverItem } from "@/types/artist";
import { loadCollection } from "@/services/collection";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";

/** 封面可播放的合集类型 */
export type CoverPlayType = "album" | "playlist";

/** 封面播放目标的来源信息 */
export interface CoverPlayTarget {
  /** 内容来源 */
  source: TrackSource;
  /** 合集类型 */
  type: CoverPlayType;
  /** 流媒体服务器 ID */
  serverId?: string;
}

/** 合集类型对应的播放来源类型 */
const ORIGIN_TYPES: Record<CoverPlayType, PlaybackOriginType> = {
  album: "album",
  playlist: "playlist",
};

/**
 * 封面悬停播放按钮：按来源读取整张专辑或歌单后直接播放
 */
export const useCoverPlay = () => {
  const { t } = useI18n();
  /** 正在加载的封面 ID，用于禁用重复触发 */
  const pendingId = ref<string | null>(null);

  /**
   * 播放封面所属的专辑或歌单
   * @param item - 封面条目
   * @param target - 合集来源信息
   */
  const playCover = async (item: CoverItem, target: CoverPlayTarget): Promise<void> => {
    if (pendingId.value) return;
    pendingId.value = item.id;
    try {
      // 歌单按批次回调，取最后一次结果才能拿到完整曲目
      const snapshots: (Collection | null)[] = [];
      await loadCollection(target.source, target.type, item.id, {
        serverId: target.serverId,
        fallbackName: item.title,
        onUpdate: (collection) => snapshots.push(collection),
      });
      const collection = snapshots[snapshots.length - 1] ?? null;
      if (!collection || collection.tracks.length === 0) {
        toast.warning(t("common.noData"));
        return;
      }
      await player.playFrom(collection.tracks, {
        context: {
          provider: collection.source,
          originId: collection.id,
          originType: ORIGIN_TYPES[target.type],
          originName: collection.title,
        },
      });
    } catch (error) {
      console.error("[coverPlay] 播放失败:", error);
      toast.error(t("common.playFailed"));
    } finally {
      pendingId.value = null;
    }
  };

  return { playCover, pendingId };
};
