/**
 * 合集加载服务：按 source/type 派发到具体来源
 *
 * 调用约定：
 * - 所有来源都通过 `options.onUpdate(collection)` 回调上报
 * - 一次性来源（local / streaming）只回调一次最终值
 * - 增量来源（netease）会多次回调，UI 边收边显
 */

import type { Track, TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useLibraryStore } from "@/stores/library";
import { useStreamingStore } from "@/stores/streaming";
import { fetchAlbum } from "@/apis/album/netease";
import { fetchPlaylist } from "@/apis/playlist/netease";

export interface LoadCollectionOptions {
  /** 名称兜底 */
  fallbackName?: string;
  /** 数据更新回调（首次填充 + 后续增量批次都会触发） */
  onUpdate: (collection: Collection | null) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 加载指定合集
 * @param source 来源：local / streaming / netease（未来扩展 qqmusic / kugou）
 * @param type   类型：playlist / album
 * @param id     合集 id（route 原始字符串）
 * @param options 回调与中断信号
 */
export const loadCollection = async (
  source: TrackSource,
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  if (source === "local" && type === "playlist") {
    const result = await usePlaylistStore().get(id);
    if (options.signal?.aborted) return;
    options.onUpdate(result);
    return;
  }
  if (source === "local" && type === "album") {
    const result = await useLibraryStore().getAlbumCollection(decodeURIComponent(id));
    if (options.signal?.aborted) return;
    options.onUpdate(result);
    return;
  }
  if (source === "streaming") {
    await loadStreaming(type, id, options);
    return;
  }
  if (source === "netease" && type === "playlist") {
    await loadNeteasePlaylist(id, options);
    return;
  }
  if (source === "netease" && type === "album") {
    await loadNeteaseAlbum(id, options);
    return;
  }
  options.onUpdate(null);
};

const loadStreaming = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const streamingStore = useStreamingStore();
  const originalId = decodeURIComponent(id);
  const fallbackName = options.fallbackName ?? originalId;

  if (type === "album") {
    const album = streamingStore.albums.find((a) => a.id === originalId);
    const tracks = await streamingStore.fetchAlbumSongs(originalId);
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
    const pl = streamingStore.playlists.find((p) => p.id === originalId);
    const tracks = await streamingStore.fetchPlaylistSongs(originalId);
    if (options.signal?.aborted) return;
    options.onUpdate({
      id: originalId,
      type,
      source: "streaming",
      title: pl?.name ?? fallbackName,
      cover: pl?.cover ?? tracks[0]?.cover,
      description: pl?.description,
      creator: pl?.owner,
      tracks,
      trackCount: tracks.length,
    });
  }
};

const loadNeteaseAlbum = async (id: string, options: LoadCollectionOptions): Promise<void> => {
  const result = await fetchAlbum(decodeURIComponent(id));
  if (options.signal?.aborted) return;
  if (!result) {
    options.onUpdate(null);
    return;
  }
  options.onUpdate({
    id,
    type: "album",
    source: "netease",
    title: result.album.name,
    cover: result.album.cover,
    description: result.description,
    creator: result.album.artist,
    tracks: result.tracks,
    trackCount: result.tracks.length,
  });
};

const loadNeteasePlaylist = async (id: string, options: LoadCollectionOptions): Promise<void> => {
  const accumulated: Track[] = [];
  let meta: {
    name: string;
    cover?: string;
    description?: string;
    creator?: string;
    trackCount?: number;
  } | null = null;

  const buildCurrent = (): Collection | null => {
    if (!meta) return null;
    return {
      id,
      type: "playlist",
      source: "netease",
      title: meta.name,
      cover: meta.cover,
      description: meta.description,
      creator: meta.creator,
      tracks: [...accumulated],
      trackCount: meta.trackCount ?? accumulated.length,
    };
  };

  await fetchPlaylist(id, {
    signal: options.signal,
    onMeta: (m) => {
      if (options.signal?.aborted) return;
      meta = {
        name: m.name,
        cover: m.cover,
        description: m.description,
        creator: m.owner,
        trackCount: m.trackCount,
      };
      options.onUpdate(buildCurrent());
    },
    onBatch: (batch) => {
      if (options.signal?.aborted) return;
      accumulated.push(...batch);
      options.onUpdate(buildCurrent());
    },
  });
};
