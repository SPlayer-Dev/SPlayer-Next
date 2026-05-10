/**
 * 流媒体响应 → 统一 Track / Album / Artist / Playlist 类型
 */
import { secToMs } from "@/utils/time";
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { StreamingServerConfig } from "@shared/types/streaming";

/**
 * 生成稳定的 Track.id：`${cfg.id}:${originalId}`
 * @param cfg - 服务器配置
 * @param originalId - 服务器侧 id
 */
export const trackId = (cfg: StreamingServerConfig, originalId: string): string =>
  `${cfg.id}:${originalId}`;

export interface SubsonicSong {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  duration?: number;
  bitRate?: number;
  samplingRate?: number;
  bitDepth?: number;
  channelCount?: number;
  suffix?: string;
  size?: number;
  coverArt?: string;
  year?: number;
  /** OpenSubsonic 扩展：结构化的多歌手数组，优先于 artist 字符串 */
  artists?: { id?: string; name: string }[];
  /** OpenSubsonic 扩展：服务器选定的显示串，如 "AC/DC" */
  displayArtist?: string;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
  song?: SubsonicSong[];
  /** OpenSubsonic 扩展：服务器选定的显示串 */
  displayArtist?: string;
}

export interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
}

export interface SubsonicPlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount?: number;
  coverArt?: string;
  owner?: string;
  entry?: SubsonicSong[];
}

/** 每次请求都要新生成 salt+token，所以传一个 builder 闭包 */
export type SubsonicAuthBuilder = (cfg: StreamingServerConfig) => URLSearchParams;

/**
 * 拼 Subsonic getCoverArt URL；coverArtId 为空返回 undefined
 * @param cfg - 服务器配置
 * @param coverArtId - 服务器侧封面 id
 * @param buildAuth - 鉴权 query builder
 * @param size - 可选边长（像素）
 */
const subsonicCoverUrl = (
  cfg: StreamingServerConfig,
  coverArtId: string | undefined,
  buildAuth: SubsonicAuthBuilder,
  size?: number,
): string | undefined => {
  if (!coverArtId) return undefined;
  const base = cfg.url.replace(/\/+$/, "");
  const params = buildAuth(cfg);
  params.set("id", coverArtId);
  if (size) params.set("size", String(size));
  return `${base}/rest/getCoverArt?${params.toString()}`;
};

/**
 * 拼 Subsonic stream URL（带 format=raw 强制原文件，避免服务器侧默认转码）
 *
 * format=raw 是 OpenSubsonic 标准；旧 Subsonic 不识别会忽略，配合 maxBitRate=0 双保险
 * @param cfg - 服务器配置
 * @param songId - 歌曲 id
 * @param buildAuth - 鉴权 query builder
 */
export const subsonicStreamUrl = (
  cfg: StreamingServerConfig,
  songId: string,
  buildAuth: SubsonicAuthBuilder,
): string => {
  const base = cfg.url.replace(/\/+$/, "");
  const params = buildAuth(cfg);
  params.set("id", songId);
  params.set("estimateContentLength", "true");
  params.set("format", "raw");
  params.set("maxBitRate", "0");
  return `${base}/rest/stream?${params.toString()}`;
};

/** 取 Subsonic 歌曲的歌手字段 */
const resolveSubsonicArtists = (song: SubsonicSong): Artist[] => {
  if (song.artists && song.artists.length > 0) {
    return song.artists.map((a) => ({ id: a.id, name: a.name }));
  }
  const name = (song.displayArtist ?? song.artist ?? "").trim();
  if (!name) return [];
  return [{ id: song.artistId, name }];
};

/**
 * Subsonic 歌曲 → 统一 Track
 * @param cfg - 服务器配置
 * @param song - Subsonic 响应里的 song 节点
 * @param buildAuth - 鉴权 query builder
 */
export const subsonicSongToTrack = (
  cfg: StreamingServerConfig,
  song: SubsonicSong,
  buildAuth: SubsonicAuthBuilder,
): Track => ({
  id: trackId(cfg, song.id),
  source: "streaming",
  serverId: cfg.id,
  originalId: song.id,
  title: song.title || "",
  artists: resolveSubsonicArtists(song),
  album: song.album ? { id: song.albumId, name: song.album } : undefined,
  duration: secToMs(song.duration),
  // Track 封面同时用于列表（小图）和全屏播放器（大图），取 500 兼顾两者
  cover: subsonicCoverUrl(cfg, song.coverArt, buildAuth, 500),
  fileSize: song.size,
  quality: {
    sampleRate: song.samplingRate ?? 0,
    channels: song.channelCount ?? 2,
    bitsPerSample: song.bitDepth ?? 0,
    bitRate: song.bitRate ? song.bitRate * 1000 : 0,
    codec: song.suffix ?? "",
  },
});

/**
 * Subsonic 专辑 → 统一 Album
 * @param cfg - 服务器配置
 * @param album - Subsonic album 节点
 * @param buildAuth - 鉴权 query builder
 */
export const subsonicAlbumToView = (
  cfg: StreamingServerConfig,
  album: SubsonicAlbum,
  buildAuth: SubsonicAuthBuilder,
): Album => ({
  id: album.id,
  name: album.name,
  // 优先 OpenSubsonic 的 displayArtist
  artist: album.displayArtist ?? album.artist,
  // 只用服务器明确返回的 coverArt id
  cover: subsonicCoverUrl(cfg, album.coverArt, buildAuth, 300),
  trackCount: album.songCount,
  year: album.year,
});

/**
 * Subsonic 歌手 → 统一 Artist
 * @param cfg - 服务器配置
 * @param artist - Subsonic artist 节点
 * @param buildAuth - 鉴权 query builder
 */
export const subsonicArtistToView = (
  cfg: StreamingServerConfig,
  artist: SubsonicArtist,
  buildAuth: SubsonicAuthBuilder,
): Artist => ({
  id: artist.id,
  name: artist.name,
  // 只用 coverArt 字段；artist.id 兜底会触发 404
  avatar: subsonicCoverUrl(cfg, artist.coverArt, buildAuth, 300),
  albumCount: artist.albumCount,
});

/**
 * Subsonic 歌单 → 统一 Playlist
 * @param cfg - 服务器配置
 * @param pl - Subsonic playlist 节点
 * @param buildAuth - 鉴权 query builder
 */
export const subsonicPlaylistToView = (
  cfg: StreamingServerConfig,
  pl: SubsonicPlaylist,
  buildAuth: SubsonicAuthBuilder,
): Playlist => ({
  id: pl.id,
  name: pl.name,
  description: pl.comment,
  cover: subsonicCoverUrl(cfg, pl.coverArt, buildAuth, 300),
  trackCount: pl.songCount,
  owner: pl.owner,
});

export interface JellyItem {
  Id: string;
  Name?: string;
  Type?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  AlbumArtistId?: string;
  Artists?: string[];
  ArtistItems?: { Id: string; Name: string }[];
  RunTimeTicks?: number;
  ProductionYear?: number;
  ChildCount?: number;
  ImageTags?: { Primary?: string };
  AlbumPrimaryImageTag?: string;
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
 * Jellyfin/Emby 100ns ticks → 毫秒
 * @param ticks - RunTimeTicks
 */
const jellyTicksToMs = (ticks?: number): number => {
  if (!ticks) return 0;
  return Math.floor(ticks / 10_000);
};

/**
 * 拼 Jellyfin/Emby 封面图 URL；缺 accessToken 返回 undefined
 * @param cfg - 服务器配置
 * @param itemId - 条目 itemId
 * @param tag - 图片 tag（用于缓存破坏）
 * @param maxHeight - 缩放高度上限
 */
export const jellyImageUrl = (
  cfg: StreamingServerConfig,
  itemId: string,
  tag?: string,
  maxHeight?: number,
): string | undefined => {
  if (!cfg.accessToken) return undefined;
  const base = cfg.url.replace(/\/+$/, "");
  const params = new URLSearchParams({ api_key: cfg.accessToken });
  if (tag) params.set("tag", tag);
  if (maxHeight) params.set("maxHeight", String(maxHeight));
  return `${base}/Items/${itemId}/Images/Primary?${params.toString()}`;
};

/**
 * Jellyfin/Emby 音频条目 → 统一 Track
 * @param cfg - 服务器配置
 * @param item - 服务器返回的 JellyItem
 */
export const jellyItemToTrack = (cfg: StreamingServerConfig, item: JellyItem): Track => {
  const audioStream = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === "Audio");
  const mediaSrc = item.MediaSources?.[0];
  // 没有自己的 imageTag 就不显示封面，避免 fallback 到 album 时的 404 刷屏
  const imageTag = item.ImageTags?.Primary;
  const cover = imageTag ? jellyImageUrl(cfg, item.Id, imageTag, 500) : undefined;
  return {
    id: trackId(cfg, item.Id),
    source: "streaming",
    serverId: cfg.id,
    originalId: item.Id,
    title: item.Name ?? "",
    artists:
      item.ArtistItems?.map((a) => ({ id: a.Id, name: a.Name })) ??
      item.Artists?.map((name) => ({ name })) ??
      [],
    album: item.Album ? { id: item.AlbumId, name: item.Album } : undefined,
    duration: jellyTicksToMs(item.RunTimeTicks),
    cover,
    fileSize: mediaSrc?.Size,
    quality: {
      sampleRate: audioStream?.SampleRate ?? 0,
      channels: audioStream?.Channels ?? 2,
      bitsPerSample: audioStream?.BitDepth ?? 0,
      bitRate: mediaSrc?.Bitrate ?? 0,
      codec: audioStream?.Codec ?? mediaSrc?.Container ?? "",
    },
  };
};

/**
 * Jellyfin/Emby 专辑条目 → 统一 Album
 * @param cfg - 服务器配置
 * @param item - 服务器返回的 JellyItem
 */
export const jellyItemToAlbum = (cfg: StreamingServerConfig, item: JellyItem): Album => ({
  id: item.Id,
  name: item.Name ?? "",
  artist: item.AlbumArtist,
  cover: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  trackCount: item.ChildCount,
  year: item.ProductionYear,
});

/**
 * Jellyfin/Emby 歌手条目 → 统一 Artist
 * @param cfg - 服务器配置
 * @param item - 服务器返回的 JellyItem
 */
export const jellyItemToArtist = (cfg: StreamingServerConfig, item: JellyItem): Artist => ({
  id: item.Id,
  name: item.Name ?? "",
  avatar: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  albumCount: item.ChildCount,
});

/**
 * Jellyfin/Emby 歌单条目 → 统一 Playlist
 * @param cfg - 服务器配置
 * @param item - 服务器返回的 JellyItem
 */
export const jellyItemToPlaylist = (cfg: StreamingServerConfig, item: JellyItem): Playlist => ({
  id: item.Id,
  name: item.Name ?? "",
  cover: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  trackCount: item.ChildCount,
});

/**
 * 毫秒 → LRC 时间戳 `[mm:ss.xx]`
 * @param ms - 毫秒数
 */
export const formatLrcTimestamp = (ms: number): string => {
  const safe = Math.max(0, ms);
  const mm = Math.floor(safe / 60000);
  const ss = Math.floor((safe % 60000) / 1000);
  const xx = Math.floor((safe % 1000) / 10);
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}]`;
};
