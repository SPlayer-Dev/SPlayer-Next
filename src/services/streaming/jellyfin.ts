/**
 * Jellyfin 客户端（渲染层）
 *
 * 鉴权：POST /Users/AuthenticateByName 拿 AccessToken/UserId
 */
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingAuthResult,
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
} from "@shared/types/streaming";
import { StreamingAuthError, StreamingProtocolError, classifyError } from "./errors";
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

/** 派生稳定 deviceId（基于 cfg.id） */
const deviceId = (cfg: StreamingServerConfig): string => `splayer-next-${cfg.id}`;

/**
 * 拼 MediaBrowser 鉴权 header 字符串
 * @param cfg - 服务器配置
 */
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

/**
 * 构造请求头
 * Emby 用 X-Emby-Authorization
 * Jellyfin 用 Authorization
 * @param cfg - 服务器配置
 */
const headers = (cfg: StreamingServerConfig): Record<string, string> => {
  const auth = buildAuthHeader(cfg);
  const authHeaderName = cfg.type === "emby" ? "X-Emby-Authorization" : "Authorization";
  return {
    "Content-Type": "application/json",
    [authHeaderName]: auth,
  };
};

/**
 * 发起 Jellyfin/Emby 请求
 * 204 返回 null，2xx 解 JSON
 * @param cfg - 服务器配置
 * @param path - API 路径（不含 base URL）
 * @param init - fetch 选项
 */
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

/**
 * Ping 服务器拿版本号
 * @param cfg - 服务器配置
 */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const json = await callApi<{ Version?: string }>(cfg, "System/Info/Public");
    return { ok: true, version: json?.Version };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: classifyError(err),
    };
  }
};

/**
 * 用账号密码换取 AccessToken/UserId
 * @param cfg - 服务器配置（需 username/password）
 */
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

/**
 * 校验已登录并返回 userId
 * 缺 accessToken/userId 抛 StreamingAuthError
 * @param cfg - 服务器配置
 */
const requireAuth = (cfg: StreamingServerConfig): string => {
  if (!cfg.accessToken || !cfg.userId) {
    throw new StreamingAuthError("缺少 accessToken / userId");
  }
  return cfg.userId;
};

/**
 * 取流播放 URL（universal 端点
 * 按 Container/AudioCodec/MaxStreamingBitrate 协商）
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 itemId
 * @param playSessionId - 上层维护的 PlaySessionId；不传则随机生成
 */
export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
  playSessionId?: string,
): Promise<string> => {
  if (!cfg.accessToken) throw new StreamingAuthError("缺少 accessToken");
  // Container 列表与 Jellyfin 官方网页版对齐：mp3 必须出现两次（容器+编码）
  // 否则 server 会误判客户端不直接支持原 mp3 文件，强制走 HLS 转码（多分片 + 多连接，
  // 用 ffmpeg 同步打开 m3u8 比直接拉一个字节流慢得多，是切歌卡顿的主要原因）
  const params = new URLSearchParams({
    UserId: cfg.userId ?? "",
    DeviceId: deviceId(cfg),
    MaxStreamingBitrate: "140000000",
    Container: "opus,webm|opus,ts|mp3,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg",
    TranscodingContainer: "mp4",
    TranscodingProtocol: "hls",
    AudioCodec: "aac",
    PlaySessionId: playSessionId ?? crypto.randomUUID(),
    api_key: cfg.accessToken,
    StartTimeTicks: "0",
    EnableRedirection: "true",
    EnableRemoteMedia: "false",
    EnableAudioVbrEncoding: "true",
  });
  return `${normalizeBase(cfg.url)}/Audio/${originalId}/universal?${params.toString()}`;
};

/**
 * 调用 /Users/{id}/Items 拿条目列表
 * @param cfg - 服务器配置
 * @param userId - 已登录用户 id
 * @param query - 端点 query 参数
 */
const fetchUserItems = async (
  cfg: StreamingServerConfig,
  userId: string,
  query: Record<string, string | number>,
): Promise<{ Items?: JellyItem[] }> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  return callApi(cfg, `Users/${userId}/Items?${params.toString()}`);
};

/**
 * 拉专辑列表（按字母升序）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Album[]> => {
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

/**
 * 拉歌手列表（/Artists 端点按 AlbumArtist 聚合）
 * @param cfg - 服务器配置
 */
export const listArtists = async (cfg: StreamingServerConfig): Promise<Artist[]> => {
  const userId = requireAuth(cfg);
  const data = await callApi<{ Items?: JellyItem[]; TotalRecordCount?: number }>(
    cfg,
    `Artists?userId=${userId}&Recursive=true&SortBy=Name&SortOrder=Ascending`,
  );
  return (data.Items ?? []).map((it) => jellyItemToArtist(cfg, it));
};

/**
 * 拉歌单列表
 * @param cfg - 服务器配置
 */
export const listPlaylists = async (cfg: StreamingServerConfig): Promise<Playlist[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    IncludeItemTypes: "Playlist",
    Recursive: "true",
    SortBy: "SortName",
  });
  return (data.Items ?? []).map((it) => jellyItemToPlaylist(cfg, it));
};

/**
 * 拉歌曲列表（按入库时间倒序）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  const userId = requireAuth(cfg);
  const data = await fetchUserItems(cfg, userId, {
    IncludeItemTypes: "Audio",
    Recursive: "true",
    SortBy: "DateCreated,SortName",
    SortOrder: "Descending",
    Fields: "MediaSources",
    Limit: params?.limit ?? 100,
    StartIndex: params?.offset ?? 0,
  });
  return (data.Items ?? []).map((it) => jellyItemToTrack(cfg, it));
};

/**
 * 拉指定专辑的歌曲（按碟号、曲号排序）
 * @param cfg - 服务器配置
 * @param albumId - 专辑 itemId
 */
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

/**
 * 拉指定歌单的歌曲
 * @param cfg - 服务器配置
 * @param playlistId - 歌单 itemId
 */
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

/**
 * 拉指定歌手名下的专辑（按年份倒序）
 * @param cfg - 服务器配置
 * @param artistId - 歌手 itemId
 */
export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Album[]> => {
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

/**
 * 搜索歌曲/专辑/歌手（三类并发拉取，每类限 50 条）
 * @param cfg - 服务器配置
 * @param query - 搜索关键词
 */
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
 * 取歌词（Jellyfin 10.8+ /Audio/{id}/Lyrics）
 * 同步行转 LRC，纯文本歌词不加时间戳
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 itemId
 */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
): Promise<string | null> => {
  if (!cfg.accessToken) return null;
  try {
    const json = await callApi<{
      Metadata?: { IsSynced?: boolean | null };
      Lyrics?: { Start?: number; Text?: string }[];
    }>(cfg, `Audio/${originalId}/Lyrics`);
    const lines = json?.Lyrics ?? [];
    if (lines.length === 0) return null;
    const isSynced = json?.Metadata?.IsSynced ?? lines.some((l) => (l.Start ?? 0) > 0);
    if (!isSynced) {
      const text = lines
        .map((l) => l.Text ?? "")
        .filter(Boolean)
        .join("\n");
      return text || null;
    }
    return lines
      .map((l) => `${formatLrcTimestamp(Math.floor((l.Start ?? 0) / 10000))}${l.Text ?? ""}`)
      .join("\n");
  } catch {
    return null;
  }
};
