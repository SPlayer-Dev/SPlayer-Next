import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { StreamingPingResult } from "@shared/types/streaming";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import type { StreamingAdapter } from "./types";

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
  Id: string;
  Name?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  Artists?: string[];
  ArtistItems?: { Id: string; Name: string }[];
  RunTimeTicks?: number;
  ProductionYear?: number;
  ChildCount?: number;
  ImageTags?: { Primary?: string };
  MediaSources?: {
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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(`${apiPath}: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
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
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const result = await callApi<{ Items?: JellyItem[] }>(
    config,
    `Users/${userId}/Items?${params.toString()}`,
  );
  return result.Items ?? [];
};

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
  const imageTag = item.ImageTags?.Primary;
  return {
    id: `${config.id}:${item.Id}`,
    source: "streaming",
    serverId: config.id,
    originalId: item.Id,
    title: item.Name ?? "",
    artists:
      item.ArtistItems?.map((artist) => ({ id: artist.Id, name: artist.Name })) ??
      item.Artists?.map((name) => ({ name })) ??
      [],
    album: item.Album ? { id: item.AlbumId, name: item.Album } : undefined,
    duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10_000) : 0,
    cover: imageTag ? imageUrl(config, item.Id, imageTag, 300) : undefined,
    coverOriginal: imageTag ? imageUrl(config, item.Id, imageTag, 1500) : undefined,
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
   * 检查 Jellyfin/Emby 连通性
   * @param config - 已鉴权的主进程服务器配置
   * @returns 连通性结果
   */
  async ping(config): Promise<StreamingPingResult> {
    try {
      const result = await callApi<{ Version?: string }>(config, "System/Info/Public");
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
      SortBy: "DateCreated,SortName",
      SortOrder: "Descending",
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
    const userId = requireUserId(config);
    const result = await callApi<{ Items?: JellyItem[] }>(
      config,
      `Artists?userId=${userId}&Recursive=true&SortBy=Name&SortOrder=Ascending`,
    );
    return (result.Items ?? []).map((item) => toArtist(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌单
   * @param config - 已鉴权的主进程服务器配置
   * @returns 歌单列表
   */
  async listPlaylists(config) {
    const items = await fetchUserItems(config, {
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
    const items = await fetchUserItems(config, {
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
    const userId = requireUserId(config);
    const params = new URLSearchParams({ UserId: userId, Fields: "MediaSources" });
    const result = await callApi<{ Items?: JellyItem[] }>(
      config,
      `Playlists/${playlistId}/Items?${params.toString()}`,
    );
    return (result.Items ?? []).map((item) => toTrack(config, item));
  },

  /**
   * 读取 Jellyfin/Emby 歌手专辑
   * @param config - 已鉴权的主进程服务器配置
   * @param artistId - 服务端歌手 ID
   * @returns 歌手专辑
   */
  async getArtistAlbums(config, artistId) {
    const items = await fetchUserItems(config, {
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
    const items = await fetchUserItems(config, {
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
      api_key: config.accessToken!,
      StartTimeTicks: "0",
      Static: "true",
    });
    if (config.type === "emby") {
      params.set("EnableRedirection", "true");
      params.set("EnableRemoteMedia", "true");
      return `${config.url.replace(/\/+$/, "")}/Audio/${trackId}/universal?${params.toString()}`;
    }
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
      const result = await callApi<{
        Metadata?: { IsSynced?: boolean | null };
        Lyrics?: { Start?: number; Text?: string }[];
      }>(config, `Audio/${trackId}/Lyrics`);
      const lines = result.Lyrics ?? [];
      if (lines.length === 0) return null;
      const synced = result.Metadata?.IsSynced ?? lines.some((line) => (line.Start ?? 0) > 0);
      if (!synced) {
        const text = lines
          .map((line) => line.Text ?? "")
          .filter(Boolean)
          .join("\n");
        return text || null;
      }
      return lines
        .map((line) => {
          const milliseconds = Math.floor((line.Start ?? 0) / 10_000);
          const minutes = Math.floor(milliseconds / 60_000);
          const seconds = Math.floor((milliseconds % 60_000) / 1000);
          const centiseconds = Math.floor((milliseconds % 1000) / 10);
          return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}]${line.Text ?? ""}`;
        })
        .join("\n");
    } catch {
      return null;
    }
  },

  /**
   * 生成 Jellyfin/Emby 真实封面地址
   * @param config - 已鉴权的主进程服务器配置
   * @param coverId - 服务端媒体 ID
   * @param size - 目标尺寸
   * @returns 真实封面地址
   */
  async getCoverUrl(config, coverId, size) {
    const params = new URLSearchParams({ api_key: config.accessToken!, maxHeight: String(size) });
    return `${config.url.replace(/\/+$/, "")}/Items/${coverId}/Images/Primary?${params.toString()}`;
  },
};
