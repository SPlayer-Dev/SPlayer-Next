import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { kugou as kgApi } from "@/apis/kugou";
import {
  kgAlbumToCoverItem,
  kgArtistToCoverItem,
  kgPlaylistToCoverItem,
  kgSongToTrack,
  type KGAlbumItem,
  type KGArtistItem,
  type KGPlaylistItem,
  type KGSong,
} from "@/utils/format/kugou";
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
  const body = await kgApi.search<{ total?: number; songs?: KGSong[] }>({
    keywords: keyword,
    type: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.songs ?? []).map(kgSongToTrack);
  return result(items, body.total ?? items.length, offset);
};

export const albums = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kgApi.search<{ total?: number; albums?: KGAlbumItem[] }>({
    keywords: keyword,
    type: 8,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.albums ?? []).map(kgAlbumToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kgApi.search<{ total?: number; artists?: KGArtistItem[] }>({
    keywords: keyword,
    type: 9,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.artists ?? []).map(kgArtistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await kgApi.search<{ total?: number; playlists?: KGPlaylistItem[] }>({
    keywords: keyword,
    type: 2,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body.playlists ?? []).map(kgPlaylistToCoverItem);
  return result(items, body.total ?? items.length, offset);
};
