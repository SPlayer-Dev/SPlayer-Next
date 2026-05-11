/**
 * Emby 客户端
 */
import type { StreamingServerConfig } from "@shared/types/streaming";
import { StreamingAuthError } from "./errors";
import { normalizeBase } from "./http";

export {
  ping,
  authenticate,
  listAlbums,
  listArtists,
  listPlaylists,
  listSongs,
  getAlbumSongs,
  getPlaylistSongs,
  getArtistAlbums,
  getArtistSongs,
  search,
  getLyrics,
} from "./jellyfin";

/** 派生稳定 deviceId（基于 cfg.id） */
const deviceId = (cfg: StreamingServerConfig): string => `splayer-next-${cfg.id}`;

/**
 * 取流播放 URL（Static=true 直出，不带转码参数）
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 itemId
 * @param playSessionId - 上层维护的 PlaySessionId；不传则随机生成
 */
export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
  playSessionId?: string,
): Promise<string> => {
  if (!cfg.accessToken || !cfg.userId) {
    throw new StreamingAuthError("缺少 accessToken / userId");
  }
  const params = new URLSearchParams({
    UserId: cfg.userId,
    DeviceId: deviceId(cfg),
    PlaySessionId: playSessionId ?? crypto.randomUUID(),
    api_key: cfg.accessToken,
    StartTimeTicks: "0",
    EnableRedirection: "true",
    EnableRemoteMedia: "true",
    Static: "true",
  });
  return `${normalizeBase(cfg.url)}/Audio/${originalId}/universal?${params.toString()}`;
};
