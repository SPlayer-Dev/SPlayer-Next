/**
 * Jellyfin 客户端（渲染层）
 *
 * 鉴权：POST /Users/AuthenticateByName 拿 AccessToken/UserId；后续请求带 X-Emby-Authorization
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
} from "@shared/types/streaming";
import { StreamingAuthError, StreamingProtocolError } from "./errors";
import { ensureOk, fetchWithTimeout, normalizeBase } from "./http";
import {
  type JellyItem,
  formatLrcTimestamp,
  jellyItemToAlbum,
  jellyItemToArtist,
  jellyItemToPlaylist,
  jellyItemToTrack,
} from "./transform";

const CLIENT_NAME = "SPlayer-Next";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "SPlayer Desktop";

/** 派生稳定 deviceId（基于 cfg.id），用于服务器侧播放历史归并 */
const deviceId = (cfg: StreamingServerConfig): string => `splayer-next-${cfg.id}`;

const buildAuthHeader = (cfg: StreamingServerConfig): string => {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId(cfg)}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (cfg.accessToken) parts.push(`Token="${cfg.accessToken}"`);
  return `MediaBrowser ${parts.join(", ")}`;
};

const headers = (cfg: StreamingServerConfig): Record<string, string> => ({
  "Content-Type": "application/json",
  "X-Emby-Authorization": buildAuthHeader(cfg),
});

const callApi = async <T>(
  cfg: StreamingServerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const url = `${normalizeBase(cfg.url)}/${path.replace(/^\//, "")}`;
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...headers(cfg), ...(init?.headers ?? {}) },
  });
  ensureOk(res);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
};

/* ───────────── 公开 API ───────────── */

export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const json = await callApi<{ Version?: string }>(cfg, "System/Info/Public");
    return { ok: true, version: json?.Version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const authenticate = async (cfg: StreamingServerConfig): Promise<StreamingAuthResult> => {
  const json = await callApi<{ AccessToken?: string; User?: { Id?: string } }>(
    cfg,
    "Users/AuthenticateByName",
    {
      method: "POST",
      body: JSON.stringify({ Username: cfg.username, Pw: cfg.password }),
    },
  );
  const accessToken = json?.AccessToken;
  const userId = json?.User?.Id;
  if (!accessToken || !userId) {
    throw new StreamingProtocolError("登录响应缺少 AccessToken/UserId");
  }
  return { accessToken, userId };
};

const requireAuth = (cfg: StreamingServerConfig): string => {
  if (!cfg.accessToken || !cfg.userId) {
    throw new StreamingAuthError("缺少 accessToken / userId");
  }
  return cfg.userId;
};

/**
 * 流播放 URL（universal 端点）。
 *
 * universal 端点会按客户端能力（Container/AudioCodec/MaxStreamingBitrate）
 * 决定直出还是转码。MaxStreamingBitrate 给得很大，意图是优先直出原始流。
 * 参数集与老项目（dev-new/SPlayer）一致以保证兼容性。
 */
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
  });
  return `${normalizeBase(cfg.url)}/Audio/${originalId}/universal?${params.toString()}`;
};

const fetchUserItems = async (
  cfg: StreamingServerConfig,
  userId: string,
  query: Record<string, string | number>,
): Promise<{ Items?: JellyItem[] }> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  return callApi(cfg, `Users/${userId}/Items?${params.toString()}`);
};

export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<StreamingAlbum[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    IncludeItemTypes: "MusicAlbum",
    Recursive: "true",
    SortBy: "SortName",
    SortOrder: "Ascending",
    Limit: params?.limit ?? 500,
    StartIndex: params?.offset ?? 0,
  });
  return (data.Items ?? []).map((it) => jellyItemToAlbum(cfg, it));
};

export const listArtists = async (cfg: StreamingServerConfig): Promise<StreamingArtist[]> => {
  const userId = requireAuth(cfg);
  // Jellyfin 的 /Artists 端点按 AlbumArtist 字段聚合返回所有歌手
  // （URL 格式与老项目 SPlayer 对齐以保兼容性）
  const data = await callApi<{ Items?: JellyItem[]; TotalRecordCount?: number }>(
    cfg,
    `Artists?userId=${userId}&Recursive=true&SortBy=Name&SortOrder=Ascending`,
  );
  return (data.Items ?? []).map((it) => jellyItemToArtist(cfg, it));
};

export const listPlaylists = async (cfg: StreamingServerConfig): Promise<StreamingPlaylist[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    IncludeItemTypes: "Playlist",
    Recursive: "true",
    SortBy: "SortName",
  });
  return (data.Items ?? []).map((it) => jellyItemToPlaylist(cfg, it));
};

export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    IncludeItemTypes: "Audio",
    Recursive: "true",
    SortBy: "Random",
    Fields: "MediaSources",
    Limit: params?.limit ?? 100,
    StartIndex: params?.offset ?? 0,
  });
  return (data.Items ?? []).map((it) => jellyItemToTrack(cfg, it));
};

export const getAlbumSongs = async (
  cfg: StreamingServerConfig,
  albumId: string,
): Promise<Track[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    ParentId: albumId,
    IncludeItemTypes: "Audio",
    Fields: "MediaSources",
    SortBy: "ParentIndexNumber,IndexNumber,SortName",
  });
  return (data.Items ?? []).map((it) => jellyItemToTrack(cfg, it));
};

export const getPlaylistSongs = async (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  const userId = requireAuth(cfg);
  const params = new URLSearchParams({ UserId: userId, Fields: "MediaSources" });
  const data = await callApi<{ Items?: JellyItem[] }>(
    cfg,
    `Playlists/${playlistId}/Items?${params.toString()}`,
  );
  return (data.Items ?? []).map((it) => jellyItemToTrack(cfg, it));
};

export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<StreamingAlbum[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    AlbumArtistIds: artistId,
    IncludeItemTypes: "MusicAlbum",
    Recursive: "true",
    SortBy: "ProductionYear,SortName",
    SortOrder: "Descending",
  });
  return (data.Items ?? []).map((it) => jellyItemToAlbum(cfg, it));
};

export const search = async (
  cfg: StreamingServerConfig,
  query: string,
): Promise<StreamingSearchResult> => {
  const userId = requireAuth(cfg);
  const fetchByType = async (
    type: "Audio" | "MusicAlbum" | "MusicArtist",
  ): Promise<JellyItem[]> => {
    const data = await fetchUserItems(cfg, userId, {
      IncludeItemTypes: type,
      Recursive: "true",
      SearchTerm: query,
      Fields: "MediaSources",
      Limit: 50,
    });
    return data.Items ?? [];
  };
  const [songs, albums, artists] = await Promise.all([
    fetchByType("Audio"),
    fetchByType("MusicAlbum"),
    fetchByType("MusicArtist"),
  ]);
  return {
    songs: songs.map((it) => jellyItemToTrack(cfg, it)),
    albums: albums.map((it) => jellyItemToAlbum(cfg, it)),
    artists: artists.map((it) => jellyItemToArtist(cfg, it)),
  };
};

/**
 * Jellyfin 10.8+ /Audio/{id}/Lyrics → { Lyrics: { Start, Text }[] }
 * Start 是 100ns ticks。失败/无歌词都返回 null。
 */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
): Promise<string | null> => {
  if (!cfg.accessToken) return null;
  try {
    const json = await callApi<{ Lyrics?: { Start?: number; Text?: string }[] }>(
      cfg,
      `Audio/${originalId}/Lyrics`,
    );
    const lines = json?.Lyrics ?? [];
    if (lines.length === 0) return null;
    return lines
      .map((l) => `${formatLrcTimestamp(Math.floor((l.Start ?? 0) / 10000))}${l.Text ?? ""}`)
      .join("\n");
  } catch {
    return null;
  }
};
