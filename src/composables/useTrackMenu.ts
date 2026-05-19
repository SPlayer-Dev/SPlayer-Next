import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type { CollectionType } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import * as player from "@/core/player";
import { useCopyText } from "@/composables/useCopyText";
import { getShareUrl } from "@/utils/format/shareUrl";
import IconPlay from "~icons/lucide/play";
import IconListEnd from "~icons/lucide/list-end";
import IconListPlus from "~icons/lucide/list-plus";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconCopy from "~icons/lucide/copy";
import IconTrash2 from "~icons/lucide/trash-2";
import IconListMinus from "~icons/lucide/list-minus";
import IconCloudOff from "~icons/lucide/cloud-off";
import IconSearch from "~icons/lucide/search";
import IconMoreHorizontal from "~icons/lucide/more-horizontal";

export interface TrackMenuOptions {
  /** 集合类型 */
  collectionType?: CollectionType;
  /** 添加到歌单 */
  onAddToPlaylist?: (track: Track) => void;
  /** 从集合移除回调 */
  onRemove?: (track: Track) => void;
  /** 删除文件回调 */
  onDeleteFile?: (track: Track) => void;
  /** 从云盘删除回调 */
  onRemoveFromCloud?: (track: Track) => void;
}

/**
 * 歌曲操作菜单
 * @param track - 当前操作的歌曲
 * @param options - 配置项
 */
export const useTrackMenu = (track: Ref<Track | undefined>, options: TrackMenuOptions = {}) => {
  const { t } = useI18n();
  const router = useRouter();
  const { copy } = useCopyText();
  const isPlaylist = options.collectionType === "playlist";
  const isCloudView = options.collectionType === "cloud";
  // 菜单项
  const items = computed<DropdownMenuItem[]>(() => {
    const source = track.value?.source;
    const isLocal = source === "local";
    const showCloudRemove = isCloudView && track.value?.cloud === true;
    const canAddToPlaylist = source === "local" || source === "netease";
    const isOnline = source !== "local" && source !== "streaming";
    return [
      { key: "play", label: t("songList.context.play"), icon: markRaw(IconPlay) },
      { key: "playNext", label: t("songList.context.playNext"), icon: markRaw(IconListEnd) },
      {
        key: "addToPlaylist",
        label: t("collection.addTo", { type: t("collection.playlist") }),
        icon: markRaw(IconListPlus),
        separator: true,
        show: canAddToPlaylist,
      },
      {
        key: "showInExplorer",
        label: t("songList.context.showInExplorer"),
        icon: markRaw(IconFolderOpen),
        separator: true,
        show: isLocal,
      },
      {
        key: "copyPath",
        label: t("songList.context.copyPath"),
        icon: markRaw(IconCopy),
        show: isLocal,
      },
      {
        key: "removeFromCollection",
        label: t("collection.removeFrom", { type: t("collection.playlist") }),
        icon: markRaw(IconListMinus),
        separator: true,
        show: isPlaylist,
      },
      {
        key: "deleteFile",
        label: t("songList.context.deleteFile"),
        icon: markRaw(IconTrash2),
        separator: !isPlaylist,
        show: isLocal,
      },
      {
        key: "removeFromCloud",
        label: t("cloud.removeAction"),
        icon: markRaw(IconCloudOff),
        separator: true,
        show: showCloudRemove,
      },
      {
        key: "searchSame",
        label: t("songList.context.searchSame"),
        icon: markRaw(IconSearch),
        separator: true,
      },
      {
        key: "more",
        label: t("songList.context.more"),
        icon: markRaw(IconMoreHorizontal),
        children: [
          {
            key: "copyTitle",
            label: t("songList.context.copyTitle"),
            icon: markRaw(IconCopy),
          },
          {
            key: "copyId",
            label: t("songList.context.copyId"),
            icon: markRaw(IconCopy),
            show: !isLocal,
          },
          {
            key: "copyUrl",
            label: t("songList.context.copyUrl"),
            icon: markRaw(IconCopy),
            show: isOnline,
          },
        ],
      },
    ];
  });

  const handleSelect = async (key: string): Promise<void> => {
    const current = track.value;
    if (!current) return;
    switch (key) {
      case "play":
        player.playNow(current);
        break;
      case "playNext":
        player.insertToQueue(current);
        break;
      case "addToPlaylist":
        options.onAddToPlaylist?.(current);
        break;
      case "showInExplorer":
        if (current.path) window.api.system.showInExplorer(current.path);
        break;
      case "copyPath":
        await copy(current.path);
        break;
      case "removeFromCollection":
        options.onRemove?.(current);
        break;
      case "deleteFile":
        options.onDeleteFile?.(current);
        break;
      case "removeFromCloud":
        options.onRemoveFromCloud?.(current);
        break;
      case "searchSame":
        router.push({ path: "/search", query: { q: current.title } });
        break;
      case "copyTitle":
        await copy(current.title);
        break;
      case "copyId":
        await copy(current.id);
        break;
      case "copyUrl":
        await copy(getShareUrl(current));
        break;
    }
  };

  return { items, handleSelect };
};
