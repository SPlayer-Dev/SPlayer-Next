import type { Ref } from "vue";
import type { PlaybackContext, Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import type { CollectionType } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import * as player from "@/core/player";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { useStatusStore } from "@/stores/status";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { buildDownloadQualityItems } from "@/composables/useDownload";
import { getTrackShareUrl } from "@/utils/format/shareUrl";
import { openExternal } from "@/utils/url";
import IconPlay from "~icons/lucide/play";
import IconListEnd from "~icons/lucide/list-end";
import IconListPlus from "~icons/lucide/list-plus";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconSquarePen from "~icons/lucide/square-pen";
import IconDownload from "~icons/lucide/download";
import IconCopy from "~icons/lucide/copy";
import IconTrash2 from "~icons/lucide/trash-2";
import IconListMinus from "~icons/lucide/list-minus";
import IconCloudOff from "~icons/lucide/cloud-off";
import IconSearch from "~icons/lucide/search";
import IconMessageCircle from "~icons/lucide/message-circle";
import IconMoreHorizontal from "~icons/lucide/more-horizontal";
import IconPuzzle from "~icons/lucide/puzzle";

export interface TrackMenuOptions {
  /** 集合类型 */
  collectionType?: CollectionType;
  /** 是否有权从集合中移除曲目 */
  canRemove?: boolean;
  /** 隐藏播放相关菜单项 */
  hidePlayActions?: boolean;
  /** 播放来源上下文 */
  playbackContext?: Ref<PlaybackContext | undefined>;
  /** 添加到歌单 */
  onAddToPlaylist?: (track: Track) => void;
  /** 从集合移除回调 */
  onRemove?: (track: Track) => void;
  /** 删除文件回调 */
  onDeleteFile?: (track: Track) => void;
  /** 编辑元数据回调 */
  onEditTags?: (track: Track) => void;
  /** 下载回调；quality 为空表示用设置中的默认音质 */
  onDownload?: (track: Track, quality?: QualityLevel) => void;
  /** 从云盘删除回调 */
  onRemoveFromCloud?: (track: Track) => void;
}

/**
 * 歌曲操作菜单
 * @param track - 当前操作的歌曲
 * @param options - 配置项
 */
export const useTrackMenu = (
  track: Ref<Track | null | undefined>,
  options: TrackMenuOptions = {},
) => {
  const { t } = useI18n();
  const router = useRouter();
  const status = useStatusStore();
  const settings = useSettingsStore();
  const plugins = usePluginsStore();
  const { copy } = useCopyText();
  const isPlaylist = options.collectionType === "playlist";
  const isCloudView = options.collectionType === "cloud";
  const showPlay = !options.hidePlayActions;
  const canRemove = options.canRemove !== false;
  // 菜单项
  const items = computed<DropdownMenuItem[]>(() => {
    const source = track.value?.source;
    const isLocal = source === "local";
    const isCue = !!track.value?.cuePath;
    const showCloudRemove = isCloudView && track.value?.cloud === true;
    const canAddToPlaylist = source === "local" || source === "netease";
    const isOnline = source !== "local" && source !== "streaming";
    const base: DropdownMenuItem[] = [
      { key: "play", label: t("songList.context.play"), icon: markRaw(IconPlay), show: showPlay },
      {
        key: "playNext",
        label: t("songList.context.playNext"),
        icon: markRaw(IconListEnd),
        show: showPlay,
      },
      {
        key: "addToPlaylist",
        label: t("collection.addTo", { type: t("collection.playlist") }),
        icon: markRaw(IconListPlus),
        separator: showPlay,
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
        key: "editTags",
        label: t("songList.context.editTags"),
        icon: markRaw(IconSquarePen),
        show: isLocal && !isCue && !!options.onEditTags,
      },
      {
        key: "download",
        label: t("songList.context.download"),
        icon: markRaw(IconDownload),
        separator: true,
        show: !isLocal && !!options.onDownload && settings.system.download.enabled,
        children: buildDownloadQualityItems(t("download.qualityDefault"), "download:"),
      },
      {
        key: "removeFromCollection",
        label: t("collection.removeFrom", { type: t("collection.playlist") }),
        icon: markRaw(IconListMinus),
        separator: true,
        show: isPlaylist && canRemove,
      },
      {
        key: "deleteFile",
        label: t("songList.context.deleteFile"),
        icon: markRaw(IconTrash2),
        separator: !(isPlaylist && canRemove),
        show: isLocal && !isCue,
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
        key: "comments",
        label: t("comments.name"),
        icon: markRaw(IconMessageCircle),
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
    // 插件贡献：每个有 ui 权限的插件折叠成一个以插件名命名的子菜单
    const pluginGroups: DropdownMenuItem[] = [];
    for (const group of plugins.menuContributions) {
      const children = group.menus
        .filter((menu) => !menu.sources || menu.sources.includes(source ?? ""))
        .map((menu) => ({ key: `plugin:${group.pluginId}:${menu.id}`, label: menu.label }));
      if (!children.length) continue;
      pluginGroups.push({
        key: `plugin:${group.pluginId}`,
        label: group.pluginName,
        icon: markRaw(IconPuzzle),
        separator: pluginGroups.length === 0,
        children,
      });
    }
    return [...base, ...pluginGroups];
  });

  const handleSelect = async (key: string): Promise<void> => {
    const current = track.value;
    if (!current) return;
    // 下载子菜单：download:<音质>，空音质表示默认
    if (key.startsWith("download:")) {
      const quality = key.slice("download:".length);
      options.onDownload?.(current, quality ? (quality as QualityLevel) : undefined);
      return;
    }
    // 插件菜单：plugin:<插件id>:<菜单id>（插件 id 不含冒号，按首个冒号切分）
    if (key.startsWith("plugin:")) {
      const rest = key.slice("plugin:".length);
      const sep = rest.indexOf(":");
      if (sep <= 0) return;
      const res = await window.api.plugins.invokeMenu({
        pluginId: rest.slice(0, sep),
        menuId: rest.slice(sep + 1),
        track: toRaw(current),
      });
      if (!res?.ok) {
        if (res?.error) toast.error(res.error);
        return;
      }
      // 复制 / 开链由渲染层代执行（沙箱内无剪贴板、无法开窗）
      if (res.copyText) await copy(res.copyText);
      if (res.openUrl) openExternal(res.openUrl);
      if (res.toast) toast.success(res.toast);
      return;
    }
    switch (key) {
      case "play":
        player.playNow(current, options.playbackContext?.value);
        break;
      case "playNext":
        player.insertToQueue(current, undefined, options.playbackContext?.value);
        toast.success(t("songList.toast.addedToNext"));
        break;
      case "addToPlaylist":
        options.onAddToPlaylist?.(current);
        break;
      case "showInExplorer":
        if (current.cueAudioPath ?? current.path) {
          window.api.system.showInExplorer((current.cueAudioPath ?? current.path)!);
        }
        break;
      case "copyPath":
        if (current.cueAudioPath ?? current.path)
          await copy((current.cueAudioPath ?? current.path)!);
        break;
      case "removeFromCollection":
        options.onRemove?.(current);
        break;
      case "deleteFile":
        options.onDeleteFile?.(current);
        break;
      case "editTags":
        options.onEditTags?.(current);
        break;
      case "removeFromCloud":
        options.onRemoveFromCloud?.(current);
        break;
      case "searchSame":
        router.push({ path: "/search", query: { q: current.title } });
        break;
      case "comments":
        status.showComments(current);
        break;
      case "copyTitle":
        await copy(current.title);
        break;
      case "copyId":
        await copy(current.id);
        break;
      case "copyUrl":
        await copy(getTrackShareUrl(current));
        break;
    }
  };

  return { items, handleSelect };
};
