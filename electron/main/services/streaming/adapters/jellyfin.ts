import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { StreamingPingResult } from "@shared/types/streaming";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import type { StreamingAdapter } from "./types";
import { StreamingRequestError, isUnsupportedEndpoint } from "../errors";
import { streamPages } from "../pagination";
import { toStreamingLyrics } from "../lyrics";

/** Jellyfin/Emby 主进程登录会话 */
export interface StreamingAuthSession {
  accessToken: string;
  userId: string;
}

const CLIENT_NAME = "SPlayer-Next";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "SPlayer Desktop";
const REQUEST_TIMEOUT_MS = 15_000;

interface JellyItem {
  PlaylistItemId?: string;
  UserData?: { IsFavorite?: boolean };
  AlbumPrimaryImageTag?: string;
  MediaStreams?: { Type?: string; Codec?: string; Index?: number; IsExternal?: boolean }[];
  Id: string;
  Name?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  Artists?: string[];
  ArtistItems?: { Id: string; Name: string }[];
  RunTimeTicks?: number;
  /** 碟号 */
  ParentIndexNumber?: number;
  ProductionYear?: number;
  ChildCount?: number;
  ImageTags?: { Primary?: string };
  MediaSources?: {
    Id?: string;
    Container?: string;
    Bitrate?: number;
    Size?: number;
    MediaStreams?: {
      Type?: string;
      SampleRate?: number;
      BitDepth?: number;
      Channels?: number;
      Codec?: string;
    }[];
  }[];
}

/**
 * 生成稳定设备 ID
 * @param config - 主进程服务器配置
 * @returns Jellyfin/Emby 设备 ID
 */
const deviceId = (config: StreamingRuntimeConfig): string => `splayer-next-${config.id}`;

/**
 * 请求 Jellyfin/Emby API
 * @param config - 主进程服务器配置
 * @param apiPath - API 路径
 * @param init - 请求选项
 * @returns API 响应内容
 */
const callApi = async <T>(
  config: StreamingRuntimeConfig,
  apiPath: string,
  init?: RequestInit,
): Promise<T> => {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId(config)}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (config.accessToken) parts.push(`Token="${config.accessToken}"`);
  const authHeader = config.type === "emby" ? "X-Emby-Authorization" : "Authorization";
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/${apiPath.replace(/^\//, "")}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      [authHeader]: `MediaBrowser ${parts.join(", ")}`,
      ...(init?.headers ?? {}),
    },
    signal: config.signal
      ? AbortSignal.any([config.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new StreamingRequestError(
      `${apiPath.split("?")[0]}: HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
};

/**
 * 获取已登录用户 ID
 * @param config - 主进程服务器配置
 * @returns 用户 ID
 */
const requireUserId = (config: StreamingRuntimeConfig): string => {
  if (!config.accessToken || !config.userId) throw new Error("缺少 accessToken / userId");
  return config.userId;
};

/**
 * 读取当前用户的媒体条目
 * @param config - 主进程服务器配置
 * @param query - 查询参数
 * @returns 服务端媒体条目
 */
const fetchUserItems = async (
  config: StreamingRuntimeConfig,
  query: Record<string, string | number>,
): Promise<JellyItem[]> => {
  const userId = requireUserId(config);
  const params = new URLSearchParams();
  params.set("UserId", userId);
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const result = await callApi<{ Items?: JellyItem[] }>(
    config,
    `${config.type === "emby" ? `Users/${userId}/Items` : "Items"}?${params.toString()}`,
  );
  return result.Items ?? [];
};

/**
 * 汇总详情页和非歌曲索引的所有页，服务端分页上限不影响完整性
 * @param config - 已鉴权配置
 * @param query - 条目查询
 * @param endpoint - 特殊列表端点
 * @param identify - 分页条目的唯一标识，歌单使用条目 ID
 * @returns 完整条目列表
 */
const fetchAllItems = async (
  config: StreamingRuntimeConfig,
  query: Record<string, string | number>,
  endpoint?: string,
  identify: (item: JellyItem) => string | undefined = (item) => item.Id,
): Promise<JellyItem[]> => {
  const items: JellyItem[] = [];
  for await (const page of streamPages(
    async ({ offset, limit }) => {
      const pagination = { ...query, StartIndex: offset!, Limit: limit! };
      if (!endpoint) return fetchUserItems(config, pagination);
      const params = new URLSearchParams({ UserId: requireUserId(config) });
      for (const [key, value] of Object.entries(pagination)) params.set(key, String(value));
      const result = await callApi<{ Items?: JellyItem[] }>(config, `${endpoint}?${params}`);
      return result.Items ?? [];
    },
    identify,
    config.signal,
  ))
    items.push(...page);
  return items;
};

/**
 * 读取歌曲及其用户数据和媒体源
 * @param config - 已鉴权配置
 * @param trackId - 服务端歌曲 ID
 * @returns 单曲详情
 */
const fetchItem = (config: StreamingRuntimeConfig, trackId: string): Promise<JellyItem> =>
  callApi(
    config,
    config.type === "emby"
      ? `Users/${requireUserId(config)}/Items/${encodeURIComponent(trackId)}`
      : `Items/${encodeURIComponent(trackId)}?UserId=${requireUserId(config)}`,
  );

/**
 * 生成主进程代理封面地址
 * @param config - 主进程服务器配置
 * @param itemId - 媒体 ID
 * @param tag - 封面版本标识
 * @param maxHeight - 封面尺寸
 * @returns renderer 使用的封面地址
 */
const imageUrl = (
  config: StreamingRuntimeConfig,
  itemId: string,
  tag: string | undefined,
  maxHeight: number,
): string | undefined => {
  const params = new URLSearchParams({
    serverId: config.id,
    coverId: itemId,
    size: String(maxHeight),
  });
  if (tag) params.set("tag", tag);
  return `streaming-cover://image?${params.toString()}`;
};

/**
 * 转换 Jellyfin/Emby 歌曲
 * @param config - 主进程服务器配置
 * @param item - 服务端媒体条目
 * @returns 统一歌曲
 */
const toTrack = (config: StreamingRuntimeConfig, item: JellyItem): Track => {
  const mediaSource = item.MediaSources?.[0];
  const audioStream = mediaSource?.MediaStreams?.find((stream) => stream.Type === "Audio");
  const imageTag = item.ImageTags?.Primary ?? item.AlbumPrimaryImageTag;
  const coverId = item.ImageTags?.Primary ? item.Id : item.AlbumId;
  return {
    id: `${config.id}:${item.Id}`,
    source: "streaming",
    serverId: config.id,
    originalId: item.Id,
    serverRevision: config.mediaRevision ?? 0,
    favorite: Boolean(item.UserData?.IsFavorite),
    title: item.Name ?? "",
    artists:
      (item.ArtistItems?.length
        ? item.ArtistItems.map((artist) => ({
            id: artist.Id,
            name: artist.Name,
            serverId: config.id,
          }))
        : undefined) ??
      item.Artists?.map((name) => ({ name })) ??
      [],
    album: item.Album ? { id: item.AlbumId, name: item.Album, serverId: config.id } : undefined,
    disc: item.ParentIndexNumber || undefined,
    duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10_000) : 0,
    cover: coverId ? imageUrl(config, coverId, imageTag, 300) : undefined,
    coverOriginal: coverId ? imageUrl(config, coverId, imageTag, 1500) : undefined,
    fileSize: mediaSource?.Size,
    quality: {
      sampleRate: audioStream?.SampleRate ?? 0,
      channels: audioStream?.Channels ?? 2,
      bitsPerSample: audioStream?.BitDepth ?? 0,
      bitRate: mediaSource?.Bitrate ?? 0,
      codec: audioStream?.Codec ?? mediaSource?.Container ?? "",
    },
  };
};

/**
 * 转换 Jellyfin/Emby 专辑
 * @param config - 主进程服务器配置
 * @param item - 服务端媒体条目
 * @returns 统一专辑
 */
const toAlbum = (config: StreamingRuntimeConfig, item: JellyItem): Album => ({
  serverId: config.id,
  id: item.Id,
  name: item.Name ?? "",
  artist: item.AlbumArtist,
  cover: imageUrl(config, item.Id, item.ImageTags?.Primary, 300),
  trackCount: item.ChildCount,
  year: item.ProductionYear,
});

/**
 * 转换 Jellyfin/Emby 歌手
 * @param config - 主进程服务器配置
 * @param item - 服务端媒体条目
 * @returns 统一歌手
 */
const toArtist = (config: StreamingRuntimeConfig, item: JellyItem): Artist => ({
  serverId: config.id,
  id: item.Id,
  name: item.Name ?? "",
  avatar: imageUrl(config, item.Id, item.ImageTags?.Primary, 300),
  albumCount: item.ChildCount,
});

/**
 * 转换 Jellyfin/Emby 歌单
 * @param config - 主进程服务器配置
 * @param item - 服务端媒体条目
 * @returns 统一歌单
 */
const toPlaylist = (config: StreamingRuntimeConfig, item: JellyItem): Playlist => ({
  serverId: config.id,
  id: item.Id,
  name: item.Name ?? "",
  cover: imageUrl(config, item.Id, item.ImageTags?.Primary, 300),
  trackCount: item.ChildCount,
});

/**
 * 使用账号密码创建主进程会话
 * @param config - 主进程服务器配置
 * @returns 登录会话
 */
export const authenticate = async (
  config: StreamingRuntimeConfig,
): Promise<StreamingAuthSession> => {
  const result = await callApi<{ AccessToken?: string; User?: { Id?: string } }>(
    { ...config, accessToken: undefined, userId: undefined },
    "Users/AuthenticateByName",
    {
      method: "POST",
      body: JSON.stringify({ Username: config.username, Pw: config.password }),
    },
  );
  if (!result.AccessToken || !result.User?.Id) {
    throw new Error("登录响应缺少 AccessToken/UserId");
  }
  return { accessToken: result.AccessToken, userId: result.User.Id };
};

export const jellyfinAdapter: StreamingAdapter = {
  /**
   * 通过下载端点获取原文件，由服务器检查下载权限
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @returns 原文件下载地址
   */
  async getDownloadUrl(config, trackId) {
    const params = new URLSearchParams();
    requireUserId(config);
    params.set(config.type === "emby" ? "api_key" : "ApiKey", config.accessToken!);
    return `${config.url.replace(/\/+$/, "")}/Items/${encodeURIComponent(trackId)}/Download?${params}`;
  },
  /**
   * 读取当前用户的歌曲收藏状态
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @returns 收藏状态
   */
  async getFavorite(config, trackId) {
    return Boolean((await fetchItem(config, trackId)).UserData?.IsFavorite);
  },
  /**
   * 使用各平台的收藏端点并返回权威结果
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @param favorite - 目标收藏状态
   * @returns 服务端确认的状态
   */
  async setFavorite(config, trackId, favorite) {
    const userId = requireUserId(config);
    const endpoint =
      config.type === "emby"
        ? `Users/${userId}/FavoriteItems/${encodeURIComponent(trackId)}`
        : `UserFavoriteItems/${encodeURIComponent(trackId)}?UserId=${userId}`;
    const result = await callApi<{ IsFavorite: boolean }>(config, endpoint, {
      method: favorite ? "POST" : "DELETE",
    });
    return result.IsFavorite;
  },
  /**
   * 为本次播放绑定真实媒体源 ID 与直流地址
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @param sessionId - 本次播放的独立会话 ID
   * @returns 音频源
   */
  async preparePlayback(config, trackId, sessionId) {
    const item = await fetchItem(config, trackId);
    const mediaSourceId = item.MediaSources?.[0]?.Id;
    const url = new URL(await jellyfinAdapter.getStreamUrl(config, trackId, sessionId));
    if (mediaSourceId) url.searchParams.set("MediaSourceId", mediaSourceId);
    return { url: url.toString(), mediaSourceId };
  },
  /**
   * 上报开始、进度或停止，服务器负责记录播放次数
   * @param config - 已鉴权配置
   * @param report - 当前会话事件
   */
  async reportPlayback(config, report) {
    if (report.event === "scrobble") return;
    const suffix =
      report.event === "start" ? "" : report.event === "stop" ? "/Stopped" : "/Progress";
    await callApi(config, `Sessions/Playing${suffix}`, {
      method: "POST",
      body: JSON.stringify({
        ItemId: report.trackId,
        MediaSourceId: report.mediaSourceId,
        PlaySessionId: report.sessionId,
        PositionTicks: Math.round(report.positionMs * 10_000),
        IsPaused: report.paused,
        CanSeek: true,
        PlayMethod: "DirectStream",
        QueueableMediaTypes: ["Audio"],
        EventName: report.reason ?? "TimeUpdate",
      }),
    });
  },
  /**
   * 检查 Jellyfin/Emby 连通性
   * @param config - 已鉴权的主进程服务器配置
   * @returns 连通性结果
   */
  async ping(config): Promise<StreamingPingResult> {
    try {
      const result = await callApi<{ Version?: string }>(config, "System/Info/Public");
      await callApi(config, `Users/${requireUserId(config)}`);
      return { ok: true, version: result.Version };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  /**
   * 分页读取 Jellyfin/Emby 歌曲
   * @param config - 已鉴权的主进程服务器配置
   * @param params - 分页参数
   * @returns 歌曲列表
   */
  async listSongs(config, params) {
    const items = await fetchUserItems(config, {
      IncludeItemTypes: "Audio",
      Recursive: "true",
      SortBy: "SortName",
      SortOrder: "Ascending",
      Fields: "MediaSources",
      Limit: params?.limit ?? 100,
      StartIndex: params?.offset ?? 0,
    });
    return items.map((item) => toTrack(config, item));
  },

  /**
   * 分页读取 Jellyfin/Emby 专辑
   * @param config - 已鉴权的主进程服务器配置
   * @param params - 分页参数
   * @returns 专辑列表
   */
  async listAlbums(config, params) {
    const items = await fetchUserItems(config, {
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      SortBy: "SortName",
      SortOrder: "Ascending",
      Limit: params?.limit ?? 500,
      StartIndex: params?.offset ?? 0,
    });
    return items.map((item) => toAlbum(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌手
   * @param config - 已鉴权的主进程服务器配置
   * @returns 歌手列表
   */
  async listArtists(config) {
    const items = await fetchAllItems(
      config,
      { Recursive: "true", SortBy: "SortName", SortOrder: "Ascending" },
      "Artists",
    );
    return items.map((item) => toArtist(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌单
   * @param config - 已鉴权的主进程服务器配置
   * @returns 歌单列表
   */
  async listPlaylists(config) {
    const items = await fetchAllItems(config, {
      IncludeItemTypes: "Playlist",
      Recursive: "true",
      SortBy: "SortName",
    });
    return items.map((item) => toPlaylist(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 专辑歌曲
   * @param config - 已鉴权的主进程服务器配置
   * @param albumId - 服务端专辑 ID
   * @returns 专辑歌曲
   */
  async getAlbumSongs(config, albumId) {
    const items = await fetchAllItems(config, {
      ParentId: albumId,
      IncludeItemTypes: "Audio",
      Fields: "MediaSources",
      SortBy: "ParentIndexNumber,IndexNumber,SortName",
    });
    return items.map((item) => toTrack(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌单歌曲
   * @param config - 已鉴权的主进程服务器配置
   * @param playlistId - 服务端歌单 ID
   * @returns 歌单歌曲
   */
  async getPlaylistSongs(config, playlistId) {
    const items = await fetchAllItems(
      config,
      { Fields: "MediaSources" },
      `Playlists/${playlistId}/Items`,
      (item) => item.PlaylistItemId,
    );
    return items.map((item) => toTrack(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌手专辑
   * @param config - 已鉴权的主进程服务器配置
   * @param artistId - 服务端歌手 ID
   * @returns 歌手专辑
   */
  async getArtistAlbums(config, artistId) {
    const items = await fetchAllItems(config, {
      AlbumArtistIds: artistId,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      SortBy: "ProductionYear,SortName",
      SortOrder: "Descending",
    });
    return items.map((item) => toAlbum(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌手歌曲
   * @param config - 已鉴权的主进程服务器配置
   * @param artistId - 服务端歌手 ID
   * @returns 歌手歌曲
   */
  async getArtistSongs(config, artistId) {
    const items = await fetchAllItems(config, {
      ArtistIds: artistId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: "MediaSources",
      SortBy: "Album,ParentIndexNumber,IndexNumber,SortName",
    });
    return items.map((item) => toTrack(config, item));
  },

  /**
   * 生成 Jellyfin/Emby 播放地址
   * @param config - 已鉴权的主进程服务器配置
   * @param trackId - 服务端歌曲 ID
   * @param playSessionId - 播放会话 ID
   * @returns 播放地址
   */
  async getStreamUrl(config, trackId, playSessionId) {
    const userId = requireUserId(config);
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: deviceId(config),
      PlaySessionId: playSessionId ?? crypto.randomUUID(),
      StartTimeTicks: "0",
      Static: "true",
    });
    params.set(config.type === "emby" ? "api_key" : "ApiKey", config.accessToken!);
    return `${config.url.replace(/\/+$/, "")}/Audio/${trackId}/stream?${params.toString()}`;
  },

  /**
   * 读取 Jellyfin/Emby 歌词
   * @param config - 已鉴权的主进程服务器配置
   * @param trackId - 服务端歌曲 ID
   * @returns 原始歌词文本
   */
  async getLyrics(config, trackId) {
    try {
      if (config.type === "emby") {
        const item = await fetchItem(config, trackId);
        const source = item.MediaSources?.[0];
        const lyricStream = item.MediaStreams?.find(
          (stream) => stream.Type === "Subtitle" && stream.Codec?.toLowerCase() === "lrc",
        );
        if (!source?.Id || lyricStream?.Index == null) return null;
        const result = await callApi<{
          TrackEvents?: { Text?: string; StartPositionTicks?: number }[];
        }>(config, `Items/${trackId}/${source.Id}/Subtitles/${lyricStream.Index}/Stream.js`);
        return toStreamingLyrics(
          (result.TrackEvents ?? []).map((line) => ({
            text: line.Text ?? "",
            start: (line.StartPositionTicks ?? 0) / 10_000,
          })),
          true,
        );
      }
      const result = await callApi<{
        Metadata?: { IsSynced?: boolean | null };
        Lyrics?: { Start?: number; Text?: string }[];
      }>(config, `Audio/${trackId}/Lyrics`);
      const lines = result.Lyrics ?? [];
      return toStreamingLyrics(
        lines.map((line) => ({ text: line.Text ?? "", start: (line.Start ?? 0) / 10_000 })),
        result.Metadata?.IsSynced ?? lines.some((line) => (line.Start ?? 0) > 0),
      );
    } catch (error) {
      if (isUnsupportedEndpoint(error)) return null;
      throw error;
    }
  },

  /**
   * 生成 Jellyfin/Emby 真实封面地址
   * @param config - 已鉴权的主进程服务器配置
   * @param coverId - 服务端媒体 ID
   * @param size - 目标尺寸
   * @param tag - 封面版本标识
   * @returns 真实封面地址
   */
  async getCoverUrl(config, coverId, size, tag) {
    const params = new URLSearchParams({ maxHeight: String(size) });
    params.set(config.type === "emby" ? "api_key" : "ApiKey", config.accessToken!);
    if (tag) params.set("tag", tag);
    return `${config.url.replace(/\/+$/, "")}/Items/${coverId}/Images/Primary?${params.toString()}`;
  },
};
