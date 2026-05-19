/**
 * 歌手页加载服务：按 source 派发到具体来源
 */

import type { TrackSource } from "@shared/types/player";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { useLibraryStore } from "@/stores/library";
import { useStreamingStore } from "@/stores/streaming";
import { fetchArtist } from "@/apis/artist/netease";

export interface LoadArtistOptions {
  /** 名称兜底（在线源元数据返回前用于占位） */
  fallbackName?: string;
  /** 数据更新回调（一次或多次） */
  onUpdate: (artist: ArtistProfile | null) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 加载指定歌手
 * @param source 来源：local / streaming / netease
 * @param id     歌手 id（route 原始字符串）
 * @param options 回调与中断信号
 */
export const loadArtist = async (
  source: TrackSource,
  id: string,
  options: LoadArtistOptions,
): Promise<void> => {
  if (source === "local") {
    await loadLocal(id, options);
    return;
  }
  if (source === "streaming") {
    await loadStreaming(id, options);
    return;
  }
  if (source === "netease") {
    await loadNetease(id, options);
    return;
  }
  options.onUpdate(null);
};

const loadLocal = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const libraryStore = useLibraryStore();
  const artistName = decodeURIComponent(id);
  const profile = await libraryStore.getArtistProfile(artistName);
  if (options.signal?.aborted) return;
  options.onUpdate(profile);

  // 头像异步补：本地无头像时去主进程取一次，命中后再次 onUpdate
  if (profile && !profile.avatar) {
    const res = await window.api.library.fetchArtistAvatar(artistName);
    if (options.signal?.aborted) return;
    if (res.success && res.data) {
      libraryStore.setArtistAvatar(artistName, res.data);
      options.onUpdate({ ...profile, avatar: res.data });
    }
  }
};

const loadStreaming = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const streamingStore = useStreamingStore();
  const artistId = decodeURIComponent(id);
  const cached = streamingStore.artists.find((a) => a.id === artistId);
  const fallbackName = options.fallbackName ?? artistId;
  const tracks = await streamingStore.fetchArtistSongs(artistId);
  if (options.signal?.aborted) return;
  options.onUpdate({
    id: artistId,
    name: cached?.name ?? fallbackName,
    avatar: cached?.avatar,
    source: "streaming",
    tracks,
    albums: [],
    trackCount: tracks.length,
    albumCount: 0,
  });
};

const loadNetease = async (id: string, options: LoadArtistOptions): Promise<void> => {
  const result = await fetchArtist(decodeURIComponent(id));
  if (options.signal?.aborted) return;
  if (!result) {
    options.onUpdate(null);
    return;
  }
  const albums: CoverItem[] = result.albums.map((album) => ({
    id: album.id ?? "",
    title: album.name,
    cover: album.cover,
    subtitle: album.artist,
    trackCount: album.trackCount ?? 0,
  }));
  options.onUpdate({
    id,
    name: result.artist.name,
    avatar: result.artist.avatar,
    source: "netease",
    tracks: result.tracks,
    albums,
    trackCount: result.tracks.length,
    albumCount: albums.length,
  });
};
