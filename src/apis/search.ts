/**
 * 在线平台搜索接口
 *
 * 统一返回 Track / CoverItem，向页面屏蔽各平台原始结构。
 * 目前仅接入 netease，后续 qqmusic / kugou 在此扩展。
 */

import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { Platform } from "@shared/types/platform";
import { netease } from "@/apis/netease";

/** 搜索结果通用结构 */
export interface SearchResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

interface NeteaseSong {
  id: number;
  name: string;
  ar: { id: number; name: string }[];
  al: { id: number; name: string; picUrl: string };
  dt: number;
}
interface NeteaseAlbum {
  id: number;
  name: string;
  picUrl: string;
  artists: { id: number; name: string }[];
  size: number;
}
interface NeteaseArtist {
  id: number;
  name: string;
  picUrl?: string;
  img1v1Url?: string;
  albumSize?: number;
}
interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  creator?: { nickname: string };
  trackCount: number;
}

interface CloudSearchBody {
  result?: {
    songs?: NeteaseSong[];
    albums?: NeteaseAlbum[];
    artists?: NeteaseArtist[];
    playlists?: NeteasePlaylist[];
    songCount?: number;
    albumCount?: number;
    artistCount?: number;
    playlistCount?: number;
  };
}

/** netease 搜索 type 编码 */
const NETEASE_TYPE = { songs: 1, albums: 10, artists: 100, playlists: 1000 } as const;

const neteaseSongToTrack = (song: NeteaseSong): Track => ({
  id: String(song.id),
  source: "online",
  platform: "netease",
  title: song.name,
  artists: (song.ar ?? []).map((artist) => ({ id: String(artist.id), name: artist.name })),
  album: song.al
    ? { id: String(song.al.id), name: song.al.name, cover: song.al.picUrl }
    : undefined,
  duration: song.dt ?? 0,
  cover: song.al?.picUrl,
});

const neteaseAlbumToCover = (album: NeteaseAlbum): CoverItem => ({
  id: String(album.id),
  title: album.name,
  cover: album.picUrl,
  subtitle: (album.artists ?? []).map((artist) => artist.name).join(" / "),
  trackCount: album.size ?? 0,
});

const neteaseArtistToCover = (artist: NeteaseArtist): CoverItem => ({
  id: String(artist.id),
  title: artist.name,
  cover: artist.img1v1Url ?? artist.picUrl,
  subtitle: "",
  trackCount: artist.albumSize ?? 0,
});

const neteasePlaylistToCover = (playlist: NeteasePlaylist): CoverItem => ({
  id: String(playlist.id),
  title: playlist.name,
  cover: playlist.coverImgUrl,
  subtitle: playlist.creator?.nickname ?? "",
  trackCount: playlist.trackCount ?? 0,
});

const callNeteaseCloudSearch = (
  type: keyof typeof NETEASE_TYPE,
  keyword: string,
  offset: number,
  limit: number,
): Promise<CloudSearchBody> =>
  netease.cloudsearch<CloudSearchBody>({
    keywords: keyword,
    type: NETEASE_TYPE[type],
    offset,
    limit,
  });

const unsupported = (platform: Platform): never => {
  throw new Error(`Search not yet supported for platform: ${platform}`);
};

/** 搜索单曲 */
export const searchSongs = async (
  platform: Platform,
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  if (platform !== "netease") return unsupported(platform);
  const body = await callNeteaseCloudSearch("songs", keyword, offset, limit);
  const items = (body?.result?.songs ?? []).map(neteaseSongToTrack);
  const total = body?.result?.songCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

/** 搜索专辑 */
export const searchAlbums = async (
  platform: Platform,
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  if (platform !== "netease") return unsupported(platform);
  const body = await callNeteaseCloudSearch("albums", keyword, offset, limit);
  const items = (body?.result?.albums ?? []).map(neteaseAlbumToCover);
  const total = body?.result?.albumCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

/** 搜索歌手 */
export const searchArtists = async (
  platform: Platform,
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  if (platform !== "netease") return unsupported(platform);
  const body = await callNeteaseCloudSearch("artists", keyword, offset, limit);
  const items = (body?.result?.artists ?? []).map(neteaseArtistToCover);
  const total = body?.result?.artistCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

/** 搜索歌单 */
export const searchPlaylists = async (
  platform: Platform,
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  if (platform !== "netease") return unsupported(platform);
  const body = await callNeteaseCloudSearch("playlists", keyword, offset, limit);
  const items = (body?.result?.playlists ?? []).map(neteasePlaylistToCover);
  const total = body?.result?.playlistCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};
