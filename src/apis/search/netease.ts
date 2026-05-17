import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { NeteaseSong } from "@/types/netease";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks, withPicSize } from "@/utils/netease";
import type { SearchResult } from "./index";

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

const call = (
  type: keyof typeof TYPE,
  keyword: string,
  offset: number,
  limit: number,
): Promise<CloudSearchBody> =>
  neteaseApi.cloudsearch({
    keywords: keyword,
    type: TYPE[type],
    offset,
    limit,
  });

const albumToCover = (album: NeteaseAlbum): CoverItem => ({
  id: String(album.id),
  title: album.name,
  cover: withPicSize(album.picUrl),
  subtitle: (album.artists ?? []).map((artist) => artist.name).join(" / "),
  trackCount: album.size ?? 0,
});

const artistToCover = (artist: NeteaseArtist): CoverItem => ({
  id: String(artist.id),
  title: artist.name,
  cover: withPicSize(artist.img1v1Url ?? artist.picUrl),
  subtitle: "",
  trackCount: artist.albumSize ?? 0,
});

const playlistToCover = (playlist: NeteasePlaylist): CoverItem => ({
  id: String(playlist.id),
  title: playlist.name,
  cover: withPicSize(playlist.coverImgUrl),
  subtitle: playlist.creator?.nickname ?? "",
  trackCount: playlist.trackCount ?? 0,
});

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await call("songs", keyword, offset, limit);
  const items = songsToTracks(body?.result?.songs);
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
