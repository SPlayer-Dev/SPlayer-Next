import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { usePlaylistStore } from "@/stores/playlist";
import * as player from "@/core/player";
import IconPlay from "~icons/lucide/play";
import IconListEnd from "~icons/lucide/list-end";
import IconListPlus from "~icons/lucide/list-plus";
import IconPlus from "~icons/lucide/plus";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconCopy from "~icons/lucide/copy";

/**
 * 歌曲操作菜单
 * @param track - 当前操作的歌曲
 */
export const useTrackMenu = (track: Ref<Track | undefined>) => {
  const { t } = useI18n();
  const playlistStore = usePlaylistStore();

  const items = computed<DropdownMenuItem[]>(() => [
    { key: "play", label: t("songList.context.play"), icon: markRaw(IconPlay) },
    { key: "playNext", label: t("songList.context.playNext"), icon: markRaw(IconListEnd) },
    {
      key: "addToPlaylist",
      label: t("collection.addTo", { type: t("collection.playlist") }),
      icon: markRaw(IconListPlus),
      separator: true,
      children: [
        { key: "playlist:new", label: t("collection.create", { type: t("collection.playlist") }), icon: markRaw(IconPlus) },
        ...(playlistStore.playlists.length > 0
          ? [
              { key: "playlist:divider", label: "", separator: true },
              ...playlistStore.playlists.map((pl) => ({
                key: `playlist:${pl.id}`,
                label: pl.title,
                icon: markRaw(IconLucideListMusic),
              })),
            ]
          : []),
      ],
    },
    {
      key: "showInExplorer",
      label: t("songList.context.showInExplorer"),
      icon: markRaw(IconFolderOpen),
      separator: true,
    },
    { key: "copyPath", label: t("songList.context.copyPath"), icon: markRaw(IconCopy) },
  ]);

  const handleSelect = async (key: string): Promise<void> => {
    const current = track.value;
    if (!current) return;
    // 歌单相关
    if (key === "playlist:new") {
      const playlist = await playlistStore.create(t("collection.create", { type: t("collection.playlist") }));
      await playlistStore.addTracks(playlist.id, [current]);
      return;
    }
    if (key.startsWith("playlist:")) {
      await playlistStore.addTracks(key.slice("playlist:".length), [current]);
      return;
    }
    // 歌曲相关
    switch (key) {
      case "play":
        player.playNow(current);
        break;
      case "playNext":
        player.insertToQueue(current);
        break;
      case "showInExplorer":
        if (current.path) window.api.system.showInExplorer(current.path);
        break;
      case "copyPath":
        if (current.path) navigator.clipboard.writeText(current.path);
        break;
    }
  };

  return { items, handleSelect };
};
