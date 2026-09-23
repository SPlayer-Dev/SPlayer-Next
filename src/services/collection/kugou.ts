import type { CollectionType } from "@/types/collection";
import { fetchKugouAlbum } from "@/apis/album/kugou";
import { fetchKugouPlaylist } from "@/apis/playlist/kugou";
import type { LoadCollectionOptions } from "./types";

/**
 * 加载KG集合（专辑或歌单）
 * @param type - 集合类型（album 或 playlist）
 * @param id - 集合 ID
 * @param options - 加载选项
 */
export const loadKugouCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;

  if (type === "album") {
    const { album, tracks, description } = await fetchKugouAlbum(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: album.id ?? originalId,
        type,
        source: "kugou",
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
    const { playlist, tracks } = await fetchKugouPlaylist(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: playlist.id ?? originalId,
        type,
        source: "kugou",
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
