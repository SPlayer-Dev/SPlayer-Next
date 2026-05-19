import type { Ref } from "vue";
import type { Collection } from "@/types/collection";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

/**
 * 通用收藏 / 取消收藏
 *
 * 当前支持：netease playlist / album
 * 待接入：netease radio
 */
export const useCollectionSubscribe = (collection: Ref<Collection | null>) => {
  const { t } = useI18n();
  const userStore = useUserStore();
  const busy = ref(false);

  /** 当前是否已收藏 */
  const isSubscribed = computed(() => {
    const current = collection.value;
    if (!current || current.source !== "netease") return false;
    if (current.type === "playlist") {
      return userStore.subscribedPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") {
      return userStore.albums.some((item) => item.id === current.id);
    }
    return false;
  });

  /** 是否显示收藏按钮：仅 netease，且不是自建（自建无法再"收藏"） */
  const available = computed(() => {
    const current = collection.value;
    if (!current || current.source !== "netease") return false;
    if (current.type === "playlist") {
      return !userStore.createdPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") return true;
    return false;
  });

  /** 切换收藏状态 */
  const toggle = async (): Promise<void> => {
    const current = collection.value;
    if (!current || busy.value || !available.value) return;
    busy.value = true;
    try {
      const next = !isSubscribed.value;
      if (current.type === "playlist") {
        await userStore.togglePlaylistSubscribe(current.id, next);
      } else if (current.type === "album") {
        await userStore.toggleAlbumSubscribe(current.id, next);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
      toast.error(message);
    } finally {
      busy.value = false;
    }
  };

  return { available, isSubscribed, busy, toggle };
};
