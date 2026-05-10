/**
 * 流媒体客户端统一入口
 * 按 cfg.type 分发到具体协议实现
 */
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingAuthResult,
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerType,
} from "@shared/types/streaming";
import * as subsonic from "./subsonic";
import * as jellyfin from "./jellyfin";
import * as emby from "./emby";

/** Subsonic 视图鉴权缓存失效 */
export const invalidateViewAuth = subsonic.invalidateViewAuth;

/** Subsonic 协议家族类型集合 */
const SUBSONIC_TYPES = new Set<StreamingServerType>([
  "subsonic",
  "navidrome",
  "opensubsonic",
  "airsonic",
  "gonic",
  "lms",
]);

/**
 * 是否 Subsonic 协议家族
 * @param type - 服务器类型
 */
const isSubsonic = (type: StreamingServerType): boolean => SUBSONIC_TYPES.has(type);

/**
 * 是否需要 token 鉴权（Jellyfin/Emby 走 AuthenticateByName，Subsonic 系不走）
 * @param type - 服务器类型
 */
export const needsAccessToken = (type: StreamingServerType): boolean =>
  type === "jellyfin" || type === "emby";

const unsupported = (cfg: StreamingServerConfig) => new Error(`不支持的服务器类型: ${cfg.type}`);

/**
 * Ping 服务器拿版本号
 * @param cfg - 服务器配置
 */
export const ping = (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  if (isSubsonic(cfg.type)) return subsonic.ping(cfg);
  if (cfg.type === "jellyfin") return jellyfin.ping(cfg);
  if (cfg.type === "emby") return emby.ping(cfg);
  return Promise.resolve({ ok: false, error: `不支持的服务器类型: ${cfg.type}` });
};

/**
 * 用账号密码换 AccessToken/UserId（仅 jellyfin/emby）
 * @param cfg - 服务器配置（需 username/password）
 */
export const authenticate = (cfg: StreamingServerConfig): Promise<StreamingAuthResult> => {
  if (cfg.type === "jellyfin") return jellyfin.authenticate(cfg);
  if (cfg.type === "emby") return emby.authenticate(cfg);
  return Promise.reject(new Error(`${cfg.type} 不需要 accessToken 鉴权`));
};

/**
 * 拉专辑列表
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listAlbums = (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Album[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listAlbums(cfg, params);
  if (cfg.type === "jellyfin") return jellyfin.listAlbums(cfg, params);
  if (cfg.type === "emby") return emby.listAlbums(cfg, params);
  throw unsupported(cfg);
};

/**
 * 拉歌手列表
 * @param cfg - 服务器配置
 */
export const listArtists = (cfg: StreamingServerConfig): Promise<Artist[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listArtists(cfg);
  if (cfg.type === "jellyfin") return jellyfin.listArtists(cfg);
  if (cfg.type === "emby") return emby.listArtists(cfg);
  throw unsupported(cfg);
};

/**
 * 拉歌单列表
 * @param cfg - 服务器配置
 */
export const listPlaylists = (cfg: StreamingServerConfig): Promise<Playlist[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listPlaylists(cfg);
  if (cfg.type === "jellyfin") return jellyfin.listPlaylists(cfg);
  if (cfg.type === "emby") return emby.listPlaylists(cfg);
  throw unsupported(cfg);
};

/**
 * 拉歌曲列表
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listSongs = (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listSongs(cfg, params);
  if (cfg.type === "jellyfin") return jellyfin.listSongs(cfg, params);
  if (cfg.type === "emby") return emby.listSongs(cfg, params);
  throw unsupported(cfg);
};

/**
 * 拉指定专辑的歌曲
 * @param cfg - 服务器配置
 * @param albumId - 专辑 id
 */
export const getAlbumSongs = (cfg: StreamingServerConfig, albumId: string): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getAlbumSongs(cfg, albumId);
  if (cfg.type === "jellyfin") return jellyfin.getAlbumSongs(cfg, albumId);
  if (cfg.type === "emby") return emby.getAlbumSongs(cfg, albumId);
  throw unsupported(cfg);
};

/**
 * 拉指定歌单的歌曲
 * @param cfg - 服务器配置
 * @param playlistId - 歌单 id
 */
export const getPlaylistSongs = (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getPlaylistSongs(cfg, playlistId);
  if (cfg.type === "jellyfin") return jellyfin.getPlaylistSongs(cfg, playlistId);
  if (cfg.type === "emby") return emby.getPlaylistSongs(cfg, playlistId);
  throw unsupported(cfg);
};

/**
 * 拉指定歌手名下的专辑
 * @param cfg - 服务器配置
 * @param artistId - 歌手 id
 */
export const getArtistAlbums = (cfg: StreamingServerConfig, artistId: string): Promise<Album[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getArtistAlbums(cfg, artistId);
  if (cfg.type === "jellyfin") return jellyfin.getArtistAlbums(cfg, artistId);
  if (cfg.type === "emby") return emby.getArtistAlbums(cfg, artistId);
  throw unsupported(cfg);
};

/**
 * 拉指定歌手名下的所有歌曲
 * @param cfg - 服务器配置
 * @param artistId - 歌手 id
 */
export const getArtistSongs = (cfg: StreamingServerConfig, artistId: string): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getArtistSongs(cfg, artistId);
  if (cfg.type === "jellyfin") return jellyfin.getArtistSongs(cfg, artistId);
  if (cfg.type === "emby") return emby.getArtistSongs(cfg, artistId);
  throw unsupported(cfg);
};

/**
 * 搜索歌曲/专辑/歌手聚合结果
 * @param cfg - 服务器配置
 * @param query - 搜索关键词
 */
export const search = (
  cfg: StreamingServerConfig,
  query: string,
): Promise<StreamingSearchResult> => {
  if (isSubsonic(cfg.type)) return subsonic.search(cfg, query);
  if (cfg.type === "jellyfin") return jellyfin.search(cfg, query);
  if (cfg.type === "emby") return emby.search(cfg, query);
  throw unsupported(cfg);
};

/**
 * 取流播放 URL
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 id
 * @param playSessionId - 上层维护的 PlaySessionId（仅 jellyfin/emby 用）
 */
export const getStreamUrl = (
  cfg: StreamingServerConfig,
  originalId: string,
  playSessionId?: string,
): Promise<string> => {
  if (isSubsonic(cfg.type)) return subsonic.getStreamUrl(cfg, originalId, playSessionId);
  if (cfg.type === "jellyfin") return jellyfin.getStreamUrl(cfg, originalId, playSessionId);
  if (cfg.type === "emby") return emby.getStreamUrl(cfg, originalId, playSessionId);
  throw unsupported(cfg);
};

/**
 * 取歌词
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 id
 * @param hint - Subsonic 旧端点回退用的 artist/title
 */
export const getLyrics = (
  cfg: StreamingServerConfig,
  originalId: string,
  hint?: { artist?: string; title?: string },
): Promise<string | null> => {
  if (isSubsonic(cfg.type)) return subsonic.getLyrics(cfg, originalId, hint);
  if (cfg.type === "jellyfin") return jellyfin.getLyrics(cfg, originalId);
  if (cfg.type === "emby") return emby.getLyrics(cfg, originalId);
  return Promise.resolve(null);
};
