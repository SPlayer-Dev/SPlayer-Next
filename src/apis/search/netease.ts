import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { netease as neteaseApi } from "@/apis/netease";
import type { SearchResult } from "./index";

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

/** cloudsearch type 编码 */
const TYPE = { songs: 1, albums: 10, artists: 100, playlists: 1000 } as const;

/** 给 p1/p2.music.126.net 的封面 URL 拼尺寸，原图很大、列表只要 300x300 */
const withSize = (url: string | undefined, size = 300): string | undefined => {
  if (!url) return undefined;
  if (url.includes("?param=")) return url;
  return `${url}?param=${size}y${size}`;
};

const call = (
  type: keyof typeof TYPE,
  keyword: string,
  offset: number,
  limit: number,
): Promise<CloudSearchBody> =>
  neteaseApi.cloudsearch<CloudSearchBody>({
    keywords: keyword,
    type: TYPE[type],
    offset,
    limit,
  });

const songToTrack = (song: NeteaseSong): Track => {
  const cover = withSize(song.al?.picUrl);
  return {
    id: String(song.id),
    source: "online",
    platform: "netease",
    title: song.name,
    artists: (song.ar ?? []).map((artist) => ({ id: String(artist.id), name: artist.name })),
    album: song.al ? { id: String(song.al.id), name: song.al.name, cover } : undefined,
    duration: song.dt ?? 0,
    cover,
  };
};

const albumToCover = (album: NeteaseAlbum): CoverItem => ({
  id: String(album.id),
  title: album.name,
  cover: withSize(album.picUrl),
  subtitle: (album.artists ?? []).map((artist) => artist.name).join(" / "),
  trackCount: album.size ?? 0,
});

const artistToCover = (artist: NeteaseArtist): CoverItem => ({
  id: String(artist.id),
  title: artist.name,
  cover: withSize(artist.img1v1Url ?? artist.picUrl),
  subtitle: "",
  trackCount: artist.albumSize ?? 0,
});

const playlistToCover = (playlist: NeteasePlaylist): CoverItem => ({
  id: String(playlist.id),
  title: playlist.name,
  cover: withSize(playlist.coverImgUrl),
  subtitle: playlist.creator?.nickname ?? "",
  trackCount: playlist.trackCount ?? 0,
});

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await call("songs", keyword, offset, limit);
  const items = (body?.result?.songs ?? []).map(songToTrack);
  const total = body?.result?.songCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await call("albums", keyword, offset, limit);
  const items = (body?.result?.albums ?? []).map(albumToCover);
  const total = body?.result?.albumCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await call("artists", keyword, offset, limit);
  const items = (body?.result?.artists ?? []).map(artistToCover);
  const total = body?.result?.artistCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await call("playlists", keyword, offset, limit);
  const items = (body?.result?.playlists ?? []).map(playlistToCover);
  const total = body?.result?.playlistCount ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};
