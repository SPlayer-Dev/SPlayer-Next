import type { CollectionType } from "@/types/collection";
import { useStreamingStore } from "@/stores/streaming";
import type { LoadCollectionOptions } from "./types";

export const loadStreamingCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const store = useStreamingStore();
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;
  if (type === "album") {
    const album = store.albums.find((item) => item.id === originalId);
    const tracks = await store.fetchAlbumSongs(originalId);
    if (options.signal?.aborted) return;
    options.onUpdate({
      id: originalId,
      type,
      source: "streaming",
      title: album?.name ?? fallbackName,
      cover: album?.cover ?? tracks[0]?.cover,
      creator: album?.artist,
      tracks,
      trackCount: tracks.length,
    });
    return;
  }
  if (type === "playlist") {
    const playlist = store.playlists.find((item) => item.id === originalId);
    const tracks = await store.fetchPlaylistSongs(originalId);
    if (options.signal?.aborted) return;
    options.onUpdate({
      id: originalId,
      type,
      source: "streaming",
      title: playlist?.name ?? fallbackName,
      cover: playlist?.cover ?? tracks[0]?.cover,
      description: playlist?.description,
      creator: playlist?.owner,
      tracks,
      trackCount: tracks.length,
    });
    return;
  }
  options.onUpdate(null);
};
