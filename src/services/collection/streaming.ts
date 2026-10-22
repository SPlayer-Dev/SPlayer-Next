import type { CollectionType } from "@/types/collection";
import { useStreamingStore } from "@/stores/streaming";
import type { LoadCollectionOptions } from "./types";

/**
 * 从资源所属服务器读取合集，避免切换服务器后 ID 冲突
 * @param type - 合集类型
 * @param id - 服务端合集 ID
 * @param options - 所属服务器、回调与取消信号
 */
export const loadStreamingCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const store = useStreamingStore();
  const serverId = options.serverId ?? store.activeServerId;
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;
  if (type === "album") {
    const album = store.albums.find(
      (item) => item.id === originalId && (item.serverId ?? store.activeServerId) === serverId,
    );
    const tracks = await store.fetchAlbumSongs(originalId, serverId);
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
    const playlist = store.playlists.find(
      (item) => item.id === originalId && (item.serverId ?? store.activeServerId) === serverId,
    );
    const tracks = await store.fetchPlaylistSongs(originalId, serverId);
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
