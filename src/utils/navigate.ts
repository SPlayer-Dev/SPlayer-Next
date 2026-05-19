import type { TrackSource } from "@shared/types/player";
import router from "@/router";

/** 非本地源 */
const isExternal = (source: TrackSource): boolean => source !== "local";

/**
 * 跳转到专辑页
 * 非本地源没拿到真实 albumId 时静默忽略，避免用专辑名当 ID 触发服务器 400 / 路由错位
 * @param albumName - 专辑名称
 * @param options.source - 来源
 * @param options.albumId - 真实专辑 ID
 */
export const navigateToAlbum = (
  albumName?: string,
  options: { source?: TrackSource; albumId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = isExternal(source) ? options.albumId : albumName;
  if (!id?.trim()) return;
  const query =
    isExternal(source) && albumName && albumName !== id ? { name: albumName } : undefined;
  router.push({
    name: "collection",
    params: { source, type: "album", id: encodeURIComponent(id) },
    query,
  });
};

/**
 * 跳转到歌手页
 * 非本地源没拿到真实 artistId 时静默忽略
 * @param artistName - 歌手名称（本地用作聚合 key；非本地用于 query 兜底显示）
 * @param options.source - 来源；默认为 local
 * @param options.artistId - 真实歌手 ID（非本地必填）
 */
export const navigateToArtist = (
  artistName?: string,
  options: { source?: TrackSource; artistId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = isExternal(source) ? options.artistId : artistName;
  if (!id?.trim()) return;
  const query =
    isExternal(source) && artistName && artistName !== id ? { name: artistName } : undefined;
  router.push({
    name: "artist",
    params: { source, id: encodeURIComponent(id) },
    query,
  });
};

/**
 * 跳转到歌单页
 * 任意来源都依赖 playlistId（不像专辑/歌手有本地"按名聚合"的语义）
 * @param playlistId - 歌单 ID（必填）
 * @param options.source - 来源；默认为 local
 * @param options.name - 标题兜底（元数据返回前用于头部占位）
 */
export const navigateToPlaylist = (
  playlistId: string | undefined,
  options: { source?: TrackSource; name?: string } = {},
) => {
  if (!playlistId?.trim()) return;
  const source = options.source ?? "local";
  router.push({
    name: "collection",
    params: { source, type: "playlist", id: encodeURIComponent(playlistId) },
    query: options.name ? { name: options.name } : undefined,
  });
};
