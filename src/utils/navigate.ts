import type { TrackSource } from "@shared/types/player";
import router from "@/router";

/**
 * 跳转到专辑页
 * @param albumName - 专辑名称（本地）或 ID（流媒体）
 * @param options.source - 来源（local/streaming）；默认为 local
 * @param options.albumId - 流媒体专辑 ID；仅 source=streaming 可用，优先级高于 albumName
 */
export const navigateToAlbum = (
  albumName?: string,
  options: { source?: TrackSource; albumId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = source === "streaming" ? (options.albumId ?? albumName) : albumName;
  if (!id?.trim()) return;
  const query =
    source === "streaming" && albumName && albumName !== id ? { name: albumName } : undefined;
  router.push({
    name: "collection",
    params: { source, type: "album", id: encodeURIComponent(id) },
    query,
  });
};

/**
 * 跳转到歌手页
 * @param artistName - 歌手名称（本地）或 ID（流媒体）
 * @param options.source - 来源（local/streaming）；默认为 local
 * @param options.artistId - 流媒体歌手 ID；仅 source=streaming 可用，优先级高于 artistName
 */
export const navigateToArtist = (
  artistName?: string,
  options: { source?: TrackSource; artistId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = source === "streaming" ? (options.artistId ?? artistName) : artistName;
  if (!id?.trim()) return;
  const query =
    source === "streaming" && artistName && artistName !== id ? { name: artistName } : undefined;
  router.push({
    name: "artist",
    params: { source, id: encodeURIComponent(id) },
    query,
  });
};
