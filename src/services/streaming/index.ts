/**
 * 流媒体客户端统一入口（渲染层）
 *
 * 按 cfg.type 分发到具体协议实现。所有方法都是纯函数，
 * 第一个参数都是 cfg；不持有状态。
 */
import type { Track } from "@shared/types/player";
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingAuthResult,
  StreamingListParams,
  StreamingPingResult,
  StreamingPlaylist,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerType,
} from "@shared/types/streaming";
import * as subsonic from "./subsonic";
import * as jellyfin from "./jellyfin";
import * as emby from "./emby";

const isSubsonic = (type: StreamingServerType): boolean =>
  type === "subsonic" || type === "navidrome" || type === "opensubsonic";

export const needsAccessToken = (type: StreamingServerType): boolean =>
  type === "jellyfin" || type === "emby";

const unsupported = (cfg: StreamingServerConfig) => new Error(`不支持的服务器类型: ${cfg.type}`);

export const ping = (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  if (isSubsonic(cfg.type)) return subsonic.ping(cfg);
  if (cfg.type === "jellyfin") return jellyfin.ping(cfg);
  if (cfg.type === "emby") return emby.ping(cfg);
  return Promise.resolve({ ok: false, error: `不支持的服务器类型: ${cfg.type}` });
};

export const authenticate = (cfg: StreamingServerConfig): Promise<StreamingAuthResult> => {
  if (cfg.type === "jellyfin") return jellyfin.authenticate(cfg);
  if (cfg.type === "emby") return emby.authenticate(cfg);
  return Promise.reject(new Error(`${cfg.type} 不需要 accessToken 鉴权`));
};

export const listAlbums = (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<StreamingAlbum[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listAlbums(cfg, params);
  if (cfg.type === "jellyfin") return jellyfin.listAlbums(cfg, params);
  if (cfg.type === "emby") return emby.listAlbums(cfg, params);
  throw unsupported(cfg);
};

export const listArtists = (cfg: StreamingServerConfig): Promise<StreamingArtist[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listArtists(cfg);
  if (cfg.type === "jellyfin") return jellyfin.listArtists(cfg);
  if (cfg.type === "emby") return emby.listArtists(cfg);
  throw unsupported(cfg);
};

export const listPlaylists = (cfg: StreamingServerConfig): Promise<StreamingPlaylist[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listPlaylists(cfg);
  if (cfg.type === "jellyfin") return jellyfin.listPlaylists(cfg);
  if (cfg.type === "emby") return emby.listPlaylists(cfg);
  throw unsupported(cfg);
};

export const listSongs = (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.listSongs(cfg, params);
  if (cfg.type === "jellyfin") return jellyfin.listSongs(cfg, params);
  if (cfg.type === "emby") return emby.listSongs(cfg, params);
  throw unsupported(cfg);
};

export const getAlbumSongs = (cfg: StreamingServerConfig, albumId: string): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getAlbumSongs(cfg, albumId);
  if (cfg.type === "jellyfin") return jellyfin.getAlbumSongs(cfg, albumId);
  if (cfg.type === "emby") return emby.getAlbumSongs(cfg, albumId);
  throw unsupported(cfg);
};

export const getPlaylistSongs = (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getPlaylistSongs(cfg, playlistId);
  if (cfg.type === "jellyfin") return jellyfin.getPlaylistSongs(cfg, playlistId);
  if (cfg.type === "emby") return emby.getPlaylistSongs(cfg, playlistId);
  throw unsupported(cfg);
};

export const getArtistAlbums = (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<StreamingAlbum[]> => {
  if (isSubsonic(cfg.type)) return subsonic.getArtistAlbums(cfg, artistId);
  if (cfg.type === "jellyfin") return jellyfin.getArtistAlbums(cfg, artistId);
  if (cfg.type === "emby") return emby.getArtistAlbums(cfg, artistId);
  throw unsupported(cfg);
};

export const search = (
  cfg: StreamingServerConfig,
  query: string,
): Promise<StreamingSearchResult> => {
  if (isSubsonic(cfg.type)) return subsonic.search(cfg, query);
  if (cfg.type === "jellyfin") return jellyfin.search(cfg, query);
  if (cfg.type === "emby") return emby.search(cfg, query);
  throw unsupported(cfg);
};

export const getStreamUrl = (cfg: StreamingServerConfig, originalId: string): Promise<string> => {
  if (isSubsonic(cfg.type)) return subsonic.getStreamUrl(cfg, originalId);
  if (cfg.type === "jellyfin") return jellyfin.getStreamUrl(cfg, originalId);
  if (cfg.type === "emby") return emby.getStreamUrl(cfg, originalId);
  throw unsupported(cfg);
};

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
