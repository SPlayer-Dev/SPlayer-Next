import type { CollectionType } from "@/types/collection";
import { fetchBdAlbum } from "@/apis/album/bd";
import { fetchBdPlaylist } from "@/apis/playlist/bd";
import type { LoadCollectionOptions } from "./types";

/**
 * 加载 BD 集合（专辑或歌单）
 * @param type - 集合类型（album 或 playlist）
 * @param id - 集合 ID
 * @param options - 加载选项
 */
export const loadBdCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;

  if (type === "album") {
    const { album, tracks, description } = await fetchBdAlbum(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: album.id ?? originalId,
        type,
        source: "bd",
        title: album.name,
        cover: album.cover,
        creator: album.artist,
        description,
        tracks,
        trackCount: album.trackCount ?? tracks.length,
      });
    }
    return;
  }

  if (type === "playlist") {
    const { playlist, tracks } = await fetchBdPlaylist(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: playlist.id ?? originalId,
        type,
        source: "bd",
        title: playlist.name,
        cover: playlist.cover,
        description: playlist.description,
        creator: playlist.owner,
        tracks,
        trackCount: playlist.trackCount ?? tracks.length,
      });
    }
    return;
  }

  options.onUpdate(null);
};
