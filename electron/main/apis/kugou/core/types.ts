/**
 * KG 模块类型定义
 */

export type KGParams = Record<string, unknown>;

export type KGModule = (params: KGParams) => Promise<unknown>;

export type Quality = "128k" | "320k" | "flac" | "flac24bit";

export interface KGSong {
  id: string;
  audioId: number;
  albumAudioId?: number;
  hash: string;
  name: string;
  artist: string;
  artistId?: string | number;
  artists?: Array<{ id?: string | number; name: string }>;
  album: string;
  albumId: string | number;
  cover?: string;
  coverOriginal?: string;
  interval: number;
  duration: number;
  qualities: Quality[];
  hashes: Partial<Record<Quality, string>>;
  sizes: Partial<Record<Quality, number>>;
  pay?: {
    payplay?: number;
    privilege?: number;
    feetype?: number;
    pkg_price?: number;
    price?: number;
  };
}

export interface KGAlbumItem {
  id: string;
  name: string;
  cover?: string;
  artist: string;
  artistId?: string | number;
  trackCount: number;
  publishTime?: string;
  intro?: string;
}

export interface KGArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount: number;
  songCount: number;
  fansCount?: number;
}

export interface KGPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator: string;
  trackCount: number;
  playCount: number;
}
