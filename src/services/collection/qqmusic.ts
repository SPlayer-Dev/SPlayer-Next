import type { CollectionType } from "@/types/collection";
import { fetchQQMusicAlbum } from "@/apis/album/qqmusic";
import { fetchQQMusicPlaylist } from "@/apis/playlist/qqmusic";
import type { LoadCollectionOptions } from "./types";

export const loadQQMusicCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;
  if (type === "album") {
    const { album, tracks } = await fetchQQMusicAlbum(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: album.id ?? originalId,
        type,
        source: "qqmusic",
        title: album.name,
        cover: album.cover,
        creator: album.artist,
        tracks,
        trackCount: album.trackCount ?? tracks.length,
      });
    }
    return;
  }
  if (type === "playlist") {
    const { playlist, tracks } = await fetchQQMusicPlaylist(originalId, fallbackName);
    if (!options.signal?.aborted) {
      options.onUpdate({
        id: playlist.id ?? originalId,
        type,
        source: "qqmusic",
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
