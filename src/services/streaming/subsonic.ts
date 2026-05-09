/**
 * Subsonic / Navidrome / OpenSubsonic 客户端
 * 鉴权：每次请求生成 salt + md5(password+salt) 作为 query 参数
 */
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
} from "@shared/types/streaming";
import { md5 } from "@/utils/md5";
import {
  StreamingAuthError,
  StreamingHttpError,
  StreamingProtocolError,
  classifyError,
} from "./errors";
import { ensureOk, fetchWithTimeout, normalizeBase } from "./http";
import {
  type SubsonicAlbum,
  type SubsonicArtist,
  type SubsonicAuthBuilder,
  type SubsonicPlaylist,
  type SubsonicSong,
  formatLrcTimestamp,
  subsonicAlbumToView,
  subsonicArtistToView,
  subsonicPlaylistToView,
  subsonicSongToTrack,
  subsonicStreamUrl,
} from "./transform";

const API_VERSION = "1.16.1";
const CLIENT_NAME = "SPlayer-Next";

/** 12 字符 hex salt */
const newSalt = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** 每个请求新生成 salt+token */
const buildAuth: SubsonicAuthBuilder = (cfg) => {
  const salt = newSalt();
  return new URLSearchParams({
    u: cfg.username,
    t: md5(cfg.password + salt),
    s: salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  });
};

/**
 * 拼出带鉴权 query 的 endpoint URL
 * @param cfg - 服务器配置
 * @param endpoint - rest/ 下的端点名（如 ping、getAlbumList2）
 * @param extra - 额外 query 参数
 */
const buildUrl = (
  cfg: StreamingServerConfig,
  endpoint: string,
  extra: Record<string, string | number> = {},
): string => {
  const params = buildAuth(cfg);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${normalizeBase(cfg.url)}/rest/${endpoint}?${params.toString()}`;
};

/**
 * 把 Subsonic 错误码（https://www.subsonic.org/pages/api.jsp#error）映射成对应错误类
 * @param code - subsonic-response.error.code
 * @param message - 服务器返回的错误描述
 */
const subsonicError = (code: number | undefined, message: string): Error => {
  if (code === 40 || code === 41 || code === 42 || code === 43 || code === 44) {
    return new StreamingAuthError(message);
  }
  if (code === 50) return new StreamingHttpError(403, message);
  if (code === 70) return new StreamingHttpError(404, message);
  return new StreamingProtocolError(message);
};

/**
 * 发起 Subsonic 请求并解包；status="failed" 时按错误码抛对应错误类
 * @param cfg - 服务器配置
 * @param endpoint - rest/ 下的端点名
 * @param extra - 额外 query 参数
 */
const callApi = async <T = Record<string, unknown>>(
  cfg: StreamingServerConfig,
  endpoint: string,
  extra: Record<string, string | number> = {},
): Promise<T> => {
  const res = await fetchWithTimeout(buildUrl(cfg, endpoint, extra));
  ensureOk(res);
  const json = (await res.json()) as { "subsonic-response"?: Record<string, unknown> };
  const wrap = json?.["subsonic-response"];
  if (!wrap) throw new StreamingProtocolError("响应缺少 subsonic-response 包装");
  if (wrap.status !== "ok") {
    const err = wrap.error as { message?: string; code?: number } | undefined;
    throw subsonicError(err?.code, err?.message || `Subsonic error code ${err?.code}`);
  }
  return wrap as T;
};

/**
 * Ping 服务器拿版本号
 * @param cfg - 服务器配置
 */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const wrap = await callApi<{ version?: string; serverVersion?: string }>(cfg, "ping");
    return { ok: true, version: wrap.serverVersion ?? wrap.version };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: classifyError(err),
    };
  }
};

/**
 * 取流播放 URL（Subsonic 协议无 PlaySessionId）
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 id
 */
export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
  _playSessionId?: string,
): Promise<string> => subsonicStreamUrl(cfg, originalId, buildAuth);

/**
 * 拉专辑列表（按字母排序）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Album[]> => {
  const wrap = await callApi<{ albumList2?: { album?: SubsonicAlbum[] } }>(cfg, "getAlbumList2", {
    type: "alphabeticalByName",
    size: params?.limit ?? 500,
    offset: params?.offset ?? 0,
  });
  return (wrap.albumList2?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth));
};

/**
 * 拉歌手列表
 * @param cfg - 服务器配置
 */
export const listArtists = async (cfg: StreamingServerConfig): Promise<Artist[]> => {
  const wrap = await callApi<{
    artists?: { index?: { artist?: SubsonicArtist[] }[] };
  }>(cfg, "getArtists");
  const out: Artist[] = [];
  for (const idx of wrap.artists?.index ?? []) {
    for (const ar of idx.artist ?? []) out.push(subsonicArtistToView(cfg, ar, buildAuth));
  }
  return out;
};

/**
 * 拉歌单列表
 * @param cfg - 服务器配置
 */
export const listPlaylists = async (cfg: StreamingServerConfig): Promise<Playlist[]> => {
  const wrap = await callApi<{ playlists?: { playlist?: SubsonicPlaylist[] } }>(
    cfg,
    "getPlaylists",
  );
  return (wrap.playlists?.playlist ?? []).map((p) => subsonicPlaylistToView(cfg, p, buildAuth));
};

/**
 * 拉歌曲列表
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  const wrap = await callApi<{ searchResult3?: { song?: SubsonicSong[] } }>(cfg, "search3", {
    query: "",
    songCount: params?.limit ?? 100,
    songOffset: params?.offset ?? 0,
    artistCount: 0,
    albumCount: 0,
  });
  return (wrap.searchResult3?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

/**
 * 拉指定专辑的歌曲
 * @param cfg - 服务器配置
 * @param albumId - 专辑 id
 */
export const getAlbumSongs = async (
  cfg: StreamingServerConfig,
  albumId: string,
): Promise<Track[]> => {
  const wrap = await callApi<{ album?: SubsonicAlbum }>(cfg, "getAlbum", { id: albumId });
  return (wrap.album?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

/**
 * 拉指定歌单的歌曲
 * @param cfg - 服务器配置
 * @param playlistId - 歌单 id
 */
export const getPlaylistSongs = async (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  const wrap = await callApi<{ playlist?: SubsonicPlaylist }>(cfg, "getPlaylist", {
    id: playlistId,
  });
  return (wrap.playlist?.entry ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

/**
 * 拉指定歌手名下的专辑
 * @param cfg - 服务器配置
 * @param artistId - 歌手 id
 */
export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Album[]> => {
  const wrap = await callApi<{ artist?: { album?: SubsonicAlbum[] } }>(cfg, "getArtist", {
    id: artistId,
  });
  return (wrap.artist?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth));
};

/**
 * 搜索歌曲/专辑/歌手（search3，显式分页）
 * @param cfg - 服务器配置
 * @param query - 搜索关键词
 */
export const search = async (
  cfg: StreamingServerConfig,
  query: string,
): Promise<StreamingSearchResult> => {
  const wrap = await callApi<{
    searchResult3?: {
      song?: SubsonicSong[];
      album?: SubsonicAlbum[];
      artist?: SubsonicArtist[];
    };
  }>(cfg, "search3", {
    query,
    artistCount: 50,
    albumCount: 50,
    songCount: 100,
  });
  return {
    songs: (wrap.searchResult3?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth)),
    albums: (wrap.searchResult3?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth)),
    artists: (wrap.searchResult3?.artist ?? []).map((a) => subsonicArtistToView(cfg, a, buildAuth)),
  };
};

/**
 * 取歌词；优先 OpenSubsonic 的 getLyricsBySongId 转 LRC，失败回退旧 getLyrics
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 id
 * @param hint - 旧端点回退用的 artist/title
 */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
  hint?: { artist?: string; title?: string },
): Promise<string | null> => {
  try {
    const wrap = await callApi<{
      lyricsList?: { structuredLyrics?: { line?: { start?: number; value: string }[] }[] };
    }>(cfg, "getLyricsBySongId", { id: originalId });
    const structured = wrap.lyricsList?.structuredLyrics?.[0]?.line ?? [];
    if (structured.length > 0) {
      return structured
        .map((l) => `${formatLrcTimestamp(l.start ?? 0)}${l.value ?? ""}`)
        .join("\n");
    }
  } catch {
    // 旧 Subsonic 没有 getLyricsBySongId，下面回退
  }

  if (hint?.artist || hint?.title) {
    try {
      const wrap = await callApi<{ lyrics?: { value?: string } }>(cfg, "getLyrics", {
        artist: hint.artist ?? "",
        title: hint.title ?? "",
      });
      const text = wrap.lyrics?.value;
      if (text && text.trim()) return text;
    } catch {
      // 没有就没有
    }
  }
  return null;
};
