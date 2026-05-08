/**
 * 流媒体响应 → 统一 Track / Album / Artist / Playlist 类型
 *
 * 各服务器返回结构差异巨大；这里把所有映射逻辑集中，便于校对。
 */
import type { Artist, Track } from "@shared/types/player";
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingPlaylist,
  StreamingServerConfig,
} from "@shared/types/streaming";

/** 常见的歌手分隔符 */
const ARTIST_SEPARATOR = /\s*(?:feat\.?|ft\.?)\s+|[/&;,×|、，]\s*/i;

/** 把"周杰伦/林俊杰"风格字符串拆成 Artist 数组 */
const parseArtists = (raw: string): Artist[] => {
  if (!raw) return [];
  return raw
    .split(ARTIST_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
};

/** 生成稳定的 Track.id：${cfg.id}:${originalId} */
export const trackId = (cfg: StreamingServerConfig, originalId: string): string =>
  `${cfg.id}:${originalId}`;

/** 秒 → 毫秒（subsonic 用秒） */
export const secToMs = (s?: number): number => Math.max(0, Math.floor((s ?? 0) * 1000));

/* ───────────── Subsonic ───────────── */

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

export const subsonicStreamUrl = (
  cfg: StreamingServerConfig,
  songId: string,
  buildAuth: SubsonicAuthBuilder,
): string => {
  const base = cfg.url.replace(/\/+$/, "");
  const params = buildAuth(cfg);
  params.set("id", songId);
  return `${base}/rest/stream?${params.toString()}`;
};

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
  artists: parseArtists(song.artist ?? ""),
  album: song.album ? { id: song.albumId, name: song.album } : undefined,
  duration: secToMs(song.duration),
  cover: subsonicCoverUrl(cfg, song.coverArt, buildAuth, 300),
  fileSize: song.size,
  quality: {
    sampleRate: song.samplingRate ?? 0,
    channels: song.channelCount ?? 2,
    bitsPerSample: song.bitDepth ?? 0,
    bitRate: song.bitRate ? song.bitRate * 1000 : 0,
    codec: song.suffix ?? "",
  },
});

export const subsonicAlbumToView = (
  cfg: StreamingServerConfig,
  album: SubsonicAlbum,
  buildAuth: SubsonicAuthBuilder,
): StreamingAlbum => ({
  id: album.id,
  name: album.name,
  artist: album.artist,
  cover: subsonicCoverUrl(cfg, album.coverArt ?? album.id, buildAuth, 300),
  songCount: album.songCount,
  year: album.year,
});

export const subsonicArtistToView = (
  cfg: StreamingServerConfig,
  artist: SubsonicArtist,
  buildAuth: SubsonicAuthBuilder,
): StreamingArtist => ({
  id: artist.id,
  name: artist.name,
  avatar: subsonicCoverUrl(cfg, artist.coverArt ?? artist.id, buildAuth, 300),
  albumCount: artist.albumCount,
});

export const subsonicPlaylistToView = (
  cfg: StreamingServerConfig,
  pl: SubsonicPlaylist,
  buildAuth: SubsonicAuthBuilder,
): StreamingPlaylist => ({
  id: pl.id,
  name: pl.name,
  description: pl.comment,
  cover: subsonicCoverUrl(cfg, pl.coverArt ?? pl.id, buildAuth, 300),
  songCount: pl.songCount,
  owner: pl.owner,
});

/* ───────────── Jellyfin / Emby ───────────── */

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

const jellyTicksToMs = (ticks?: number): number => {
  if (!ticks) return 0;
  // RunTimeTicks 是 100ns ticks：1ms = 10000 ticks
  return Math.floor(ticks / 10_000);
};

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

export const jellyItemToTrack = (cfg: StreamingServerConfig, item: JellyItem): Track => {
  const audioStream = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === "Audio");
  const mediaSrc = item.MediaSources?.[0];
  // Jellyfin/Emby 对 audio item：扫描 ID3 嵌入封面后，audio 自己会有 ImageTags.Primary。
  // 没有自己的 imageTag 就不显示封面 —— 与老项目一致，避免 fallback 到 album 时
  // 触发 album 自身没图的 404 刷屏（用 truthy 判断同时排除空字符串）。
  const imageTag = item.ImageTags?.Primary;
  const cover = imageTag ? jellyImageUrl(cfg, item.Id, imageTag, 300) : undefined;
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

export const jellyItemToAlbum = (cfg: StreamingServerConfig, item: JellyItem): StreamingAlbum => ({
  id: item.Id,
  name: item.Name ?? "",
  artist: item.AlbumArtist,
  cover: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  songCount: item.ChildCount,
  year: item.ProductionYear,
});

export const jellyItemToArtist = (
  cfg: StreamingServerConfig,
  item: JellyItem,
): StreamingArtist => ({
  id: item.Id,
  name: item.Name ?? "",
  avatar: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  albumCount: item.ChildCount,
});

export const jellyItemToPlaylist = (
  cfg: StreamingServerConfig,
  item: JellyItem,
): StreamingPlaylist => ({
  id: item.Id,
  name: item.Name ?? "",
  cover: jellyImageUrl(cfg, item.Id, item.ImageTags?.Primary, 300),
  songCount: item.ChildCount,
});

/** 把毫秒数格式化为 LRC 时间戳 [mm:ss.xx] */
export const formatLrcTimestamp = (ms: number): string => {
  const safe = Math.max(0, ms);
  const mm = Math.floor(safe / 60000);
  const ss = Math.floor((safe % 60000) / 1000);
  const xx = Math.floor((safe % 1000) / 10);
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}]`;
};
