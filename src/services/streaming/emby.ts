/**
 * Emby 客户端（渲染层）
 *
 * Emby 与 Jellyfin REST API 高度兼容，复用大部分实现。
 * 流播放 URL 同样用 /Audio/{id}/universal 端点，仅多一个 Static=true 参数
 * （Emby 文档建议显式声明直接流，与老项目一致）。
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
  search,
  getLyrics,
} from "./jellyfin";

/** Emby 用稳定 deviceId（基于 cfg.id） */
const deviceId = (cfg: StreamingServerConfig): string => `splayer-next-${cfg.id}`;

export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
): Promise<string> => {
  if (!cfg.accessToken) throw new StreamingAuthError("缺少 accessToken");
  const params = new URLSearchParams({
    UserId: cfg.userId ?? "",
    DeviceId: deviceId(cfg),
    MaxStreamingBitrate: "140000000",
    Container: "opus,webm|opus,ts|mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg",
    TranscodingContainer: "ts",
    TranscodingProtocol: "hls",
    AudioCodec: "aac",
    PlaySessionId: Date.now().toString(),
    api_key: cfg.accessToken,
    StartTimeTicks: "0",
    EnableRedirection: "true",
    EnableRemoteMedia: "true",
    Static: "true",
  });
  return `${normalizeBase(cfg.url)}/Audio/${originalId}/universal?${params.toString()}`;
};
