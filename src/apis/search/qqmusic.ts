import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import {
  qqAlbumToCoverItem,
  qqArtistToCoverItem,
  qqPlaylistToCoverItem,
  qqSongToTrack,
  type QMAlbumItem,
  type QMArtistItem,
  type QMPlaylistItem,
  type QMSong,
} from "@/utils/format/qqmusic";
import type { SearchResult } from "./index";

const result = <T>(items: T[], total: number, offset: number): SearchResult<T> => ({
  items,
  total,
  hasMore: offset + items.length < total,
});

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await qmApi.search<{ total?: number; songs?: QMSong[] }>({
    keywords: keyword,
    type: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.songs ?? []).map(qqSongToTrack);
  return result(items, body.total ?? items.length, offset);
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await qmApi.search<{ total?: number; albums?: QMAlbumItem[] }>({
    keywords: keyword,
    type: 8,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.albums ?? []).map(qqAlbumToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  // QM 歌手搜索的 n 超过 30 时会直接返回空结果，需要按接口上限换算分页。
  const requestLimit = Math.min(limit, 30);
  const body = await qmApi.search<{ total?: number; artists?: QMArtistItem[] }>({
    keywords: keyword,
    type: 9,
    page: Math.floor(offset / requestLimit) + 1,
    limit: requestLimit,
  });
  const items = (body.artists ?? []).map(qqArtistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await qmApi.search<{ total?: number; playlists?: QMPlaylistItem[] }>({
    keywords: keyword,
    type: 2,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.playlists ?? []).map(qqPlaylistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};
