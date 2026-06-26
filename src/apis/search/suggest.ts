/**
 * 搜索建议
 * 改用 cloudsearch API 替代 search_suggest，因为前者返回完整数据（含封面 URL）
 * 4 种类型并行调用，limit=3 控制延迟
 */

import { netease as neteaseApi } from "@/apis/netease";
import { withPicSize } from "@/utils/format/netease";

export interface SuggestSongItem {
  id: number;
  name: string;
  /** 多个歌手用 " / " 连接 */
  artist?: string;
  album?: string;
  /** 歌曲封面 URL（来自专辑 picUrl） */
  cover?: string;
}

export interface SuggestSimpleItem {
  id: number;
  name: string;
  subtitle?: string;
  /** 封面/头像 URL */
  cover?: string;
}

export interface SuggestData {
  songs: SuggestSongItem[];
  albums: SuggestSimpleItem[];
  artists: SuggestSimpleItem[];
  playlists: SuggestSimpleItem[];
}

interface NeteaseSong {
  id: number;
  name: string;
  artists?: Array<{ name: string }>;
  album?: { name: string; picUrl?: string };
}
interface NeteaseAlbum {
  id: number;
  name: string;
  picUrl?: string;
  artist?: { name: string };
}
interface NeteaseArtist {
  id: number;
  name: string;
  img1v1Url?: string;
  picUrl?: string;
}
interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl?: string;
  creator?: { nickname: string };
}

interface CloudSearchBody<T> {
  result?: T & {
    songCount?: number;
    albumCount?: number;
    artistCount?: number;
    playlistCount?: number;
  };
}

const EMPTY: SuggestData = { songs: [], albums: [], artists: [], playlists: [] };

/** 每种类型取前 3 条，控制延迟 */
const SUGGEST_LIMIT = 3;

/**
 * 取网易云搜索建议（含封面）
 * 并行调用 cloudsearch 4 种类型，任一失败不影响其他
 * @param keyword - 关键词
 * @returns 分类建议；keyword 空 / 接口失败时返回空集
 */
export const getSearchSuggest = async (keyword: string): Promise<SuggestData> => {
  const word = keyword.trim();
  if (!word) return { ...EMPTY };

  const params = { keywords: word, offset: 0, limit: SUGGEST_LIMIT };

  const [songsBody, albumsBody, artistsBody, playlistsBody] = await Promise.all(
    [
      neteaseApi
        .cloudsearch({ ...params, type: 1 })
        .then((b: CloudSearchBody<{ songs?: NeteaseSong[] }>) => b?.result?.songs ?? [])
        .catch(() => [] as NeteaseSong[]),
      neteaseApi
        .cloudsearch({ ...params, type: 10 })
        .then((b: CloudSearchBody<{ albums?: NeteaseAlbum[] }>) => b?.result?.albums ?? [])
        .catch(() => [] as NeteaseAlbum[]),
      neteaseApi
        .cloudsearch({ ...params, type: 100 })
        .then((b: CloudSearchBody<{ artists?: NeteaseArtist[] }>) => b?.result?.artists ?? [])
        .catch(() => [] as NeteaseArtist[]),
      neteaseApi
        .cloudsearch({ ...params, type: 1000 })
        .then((b: CloudSearchBody<{ playlists?: NeteasePlaylist[] }>) => b?.result?.playlists ?? [])
        .catch(() => [] as NeteasePlaylist[]),
    ],
  );

  return {
    songs: songsBody.map((song) => ({
      id: song.id,
      name: song.name,
      artist: (song.artists ?? [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(" / "),
      album: song.album?.name,
      cover: withPicSize(song.album?.picUrl),
    })),
    albums: albumsBody.map((album) => ({
      id: album.id,
      name: album.name,
      subtitle: album.artist?.name,
      cover: withPicSize(album.picUrl),
    })),
    artists: artistsBody.map((artist) => ({
      id: artist.id,
      name: artist.name,
      cover: withPicSize(artist.img1v1Url ?? artist.picUrl),
    })),
    playlists: playlistsBody.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      subtitle: playlist.creator?.nickname,
      cover: withPicSize(playlist.coverImgUrl),
    })),
  };
};
