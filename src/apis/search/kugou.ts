import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { kugou as kugouApi } from "@/apis/kugou";
import type { SearchResult } from "./index";

interface KGSong {
  id: string;
  hash: string;
  audioId?: number;
  name: string;
  artist: string;
  album?: string;
  albumId?: string | number;
  cover?: string;
  coverOriginal?: string;
  duration: number;
}

interface SongsResp {
  total?: number;
  songs?: KGSong[];
}

const songToTrack = (song: KGSong): Track => ({
  id: song.hash || song.id,
  source: "kugou",
  title: song.name,
  artists: song.artist ? [{ name: song.artist }] : [],
  // album.id 暂不暴露（在线专辑详情页未接通），列表里跟着 artist 一起暗显
  album: song.album ? { name: song.album, cover: song.cover } : undefined,
  cover: song.cover,
  coverOriginal: song.coverOriginal,
  duration: song.duration ?? 0,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await kugouApi.search<SongsResp>({
    keywords: keyword,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body?.songs ?? []).map(songToTrack);
  const total = body?.total ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

export const albums = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const artists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const playlists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
