import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { bd as bdApi } from "@/apis/bd";
import type { BdArtist, BdPage, BdPlaylist, BdSong } from "@shared/types/bd";
import { bdArtistToCoverItem, bdPlaylistToCoverItem, bdSongsToTracks } from "@/utils/format/bd";
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
  const body = await bdApi.search<BdPage<BdSong>>({
    keywords: keyword,
    type: "songs",
    page: Math.floor(offset / limit),
    limit,
  });
  return result(bdSongsToTracks(body.items), body.total, offset);
};

export const artists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await bdApi.search<BdPage<BdArtist>>({
    keywords: keyword,
    type: "artists",
    page: Math.floor(offset / limit),
    limit,
  });
  return result(body.items.map(bdArtistToCoverItem), body.total, offset);
};

export const playlists = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<CoverItem>> => {
  const body = await bdApi.search<BdPage<BdPlaylist>>({
    keywords: keyword,
    type: "playlists",
    page: Math.floor(offset / limit),
    limit,
  });
  return result(body.items.map(bdPlaylistToCoverItem), body.total, offset);
};
