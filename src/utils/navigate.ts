import type { TrackSource } from "@shared/types/player";
import router from "@/router";

/**
 * 跳转到专辑页
 * - local：用 albumName 作为 id
 * - streaming：必须传 albumId（服务器原生 ID），albumName 仅用作 fallback
 */
export const navigateToAlbum = (
  albumName?: string,
  options: { source?: TrackSource; albumId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = source === "streaming" ? (options.albumId ?? albumName) : albumName;
  if (!id?.trim()) return;
  router.push({
    name: "collection",
    params: { source, type: "album", id: encodeURIComponent(id) },
  });
};

/** 跳转到歌手页 */
export const navigateToArtist = (
  artistName?: string,
  options: { source?: TrackSource; artistId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = source === "streaming" ? (options.artistId ?? artistName) : artistName;
  if (!id?.trim()) return;
  router.push({
    name: "artist",
    params: { source, id: encodeURIComponent(id) },
  });
};
