/**
 * 搜索建议
 */

import { neteaseCall } from "@/apis/netease";

export interface SuggestSongItem {
  id: number;
  name: string;
  /** 多个歌手用 " / " 连接 */
  artist?: string;
  album?: string;
}

export interface SuggestSimpleItem {
  id: number;
  name: string;
  subtitle?: string;
}

export interface SuggestData {
  songs: SuggestSongItem[];
  albums: SuggestSimpleItem[];
  artists: SuggestSimpleItem[];
  playlists: SuggestSimpleItem[];
}

interface NeteaseSuggestResp {
  result?: {
    songs?: Array<{
      id: number;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    }>;
    albums?: Array<{
      id: number;
      name: string;
      artist?: { name: string };
    }>;
    artists?: Array<{ id: number; name: string }>;
    playlists?: Array<{ id: number; name: string }>;
  };
}

const EMPTY: SuggestData = { songs: [], albums: [], artists: [], playlists: [] };

/**
 * 获取搜索建议
 * @param keyword - 关键词
 * @returns 分类建议；keyword 空 / 接口失败时返回空集
 */
export const getSearchSuggest = async (keyword: string): Promise<SuggestData> => {
  const word = keyword.trim();
  if (!word) return { ...EMPTY };

  const res = await neteaseCall<NeteaseSuggestResp>("search_suggest", {
    keywords: word,
    type: "web",
  });
  const raw = res.result ?? {};
  return {
    songs: (raw.songs ?? []).map((song) => ({
      id: song.id,
      name: song.name,
      artist: (song.artists ?? [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(" / "),
      album: song.album?.name,
    })),
    albums: (raw.albums ?? []).map((album) => ({
      id: album.id,
      name: album.name,
      subtitle: album.artist?.name,
    })),
    artists: (raw.artists ?? []).map((artist) => ({
      id: artist.id,
      name: artist.name,
    })),
    playlists: (raw.playlists ?? []).map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
    })),
  };
};
