/**
 * Subsonic / Navidrome / OpenSubsonic 客户端（渲染层）
 *
 * 鉴权：每次请求生成 salt + md5(password+salt) 作为 query 参数
 */
import type { Track } from "@shared/types/player";
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingListParams,
  StreamingPingResult,
  StreamingPlaylist,
  StreamingSearchResult,
  StreamingServerConfig,
} from "@shared/types/streaming";
import { md5 } from "@/utils/md5";
import { StreamingProtocolError } from "./errors";
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

const buildUrl = (
  cfg: StreamingServerConfig,
  endpoint: string,
  extra: Record<string, string | number> = {},
): string => {
  const params = buildAuth(cfg);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${normalizeBase(cfg.url)}/rest/${endpoint}?${params.toString()}`;
};

/** subsonic-response 包装解析；status==='ok' 时返回包装本身 */
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
    throw new StreamingProtocolError(err?.message || `Subsonic error code ${err?.code}`);
  }
  return wrap as T;
};

/* ───────────── 公开 API ───────────── */

export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const wrap = await callApi<{ version?: string; serverVersion?: string }>(cfg, "ping");
    return { ok: true, version: wrap.serverVersion ?? wrap.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
): Promise<string> => subsonicStreamUrl(cfg, originalId, buildAuth);

export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<StreamingAlbum[]> => {
  const wrap = await callApi<{ albumList2?: { album?: SubsonicAlbum[] } }>(cfg, "getAlbumList2", {
    type: "alphabeticalByName",
    size: params?.limit ?? 500,
    offset: params?.offset ?? 0,
  });
  return (wrap.albumList2?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth));
};

export const listArtists = async (cfg: StreamingServerConfig): Promise<StreamingArtist[]> => {
  const wrap = await callApi<{
    artists?: { index?: { artist?: SubsonicArtist[] }[] };
  }>(cfg, "getArtists");
  const out: StreamingArtist[] = [];
  for (const idx of wrap.artists?.index ?? []) {
    for (const ar of idx.artist ?? []) out.push(subsonicArtistToView(cfg, ar, buildAuth));
  }
  return out;
};

export const listPlaylists = async (cfg: StreamingServerConfig): Promise<StreamingPlaylist[]> => {
  const wrap = await callApi<{ playlists?: { playlist?: SubsonicPlaylist[] } }>(
    cfg,
    "getPlaylists",
  );
  return (wrap.playlists?.playlist ?? []).map((p) => subsonicPlaylistToView(cfg, p, buildAuth));
};

export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  // Subsonic 没有"全部歌曲"端点；getRandomSongs 充当首页内容
  const wrap = await callApi<{ randomSongs?: { song?: SubsonicSong[] } }>(cfg, "getRandomSongs", {
    size: params?.limit ?? 100,
  });
  return (wrap.randomSongs?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

export const getAlbumSongs = async (
  cfg: StreamingServerConfig,
  albumId: string,
): Promise<Track[]> => {
  const wrap = await callApi<{ album?: SubsonicAlbum }>(cfg, "getAlbum", { id: albumId });
  return (wrap.album?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

export const getPlaylistSongs = async (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  const wrap = await callApi<{ playlist?: SubsonicPlaylist }>(cfg, "getPlaylist", {
    id: playlistId,
  });
  return (wrap.playlist?.entry ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth));
};

export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<StreamingAlbum[]> => {
  const wrap = await callApi<{ artist?: { album?: SubsonicAlbum[] } }>(cfg, "getArtist", {
    id: artistId,
  });
  return (wrap.artist?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth));
};

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
  }>(cfg, "search3", { query });
  return {
    songs: (wrap.searchResult3?.song ?? []).map((s) => subsonicSongToTrack(cfg, s, buildAuth)),
    albums: (wrap.searchResult3?.album ?? []).map((a) => subsonicAlbumToView(cfg, a, buildAuth)),
    artists: (wrap.searchResult3?.artist ?? []).map((a) => subsonicArtistToView(cfg, a, buildAuth)),
  };
};

/**
 * 优先 OpenSubsonic 的 getLyricsBySongId（结构化）→ 转 LRC；
 * 失败回退旧端点 getLyrics（artist+title）。任一拿不到都返回 null。
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
