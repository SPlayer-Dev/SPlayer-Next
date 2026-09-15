import type { ErrorCode } from "./errors";

export interface BdAudio {
  format: string;
  bitrate: number | string;
}

export interface BdTrackInfo {
  freeSign?: string;
  audios: BdAudio[];
}

export interface BdSong {
  id: string | number;
  name?: string;
  songName?: string;
  artist?: string;
  artistId?: string | number;
  artistPic?: string;
  artists?: Array<{ id?: string | number; name: string; pic?: string }>;
  album?: string;
  albumId?: string | number;
  albumPic?: string;
  albumPic120?: string;
  duration?: number;
  audios?: BdAudio[];
  freeSign?: string;
  fsig?: string;
}

export interface BdArtist {
  id: string | number;
  name: string;
  pic?: string;
  artistPic?: string;
  musicCnt?: number;
  albumCnt?: number;
}

export interface BdAlbum {
  id?: string | number;
  albumId?: string | number;
  name: string;
  artist?: string;
  pic?: string;
  albumPic?: string;
  albumPic120?: string;
  musicCount?: number;
  musicCnt?: number;
  songNum?: number;
  showtime?: string;
  releaseDate?: string;
  description?: string;
  info?: string;
}

export interface BdPlaylist {
  id: string | number;
  name: string;
  pic?: string;
  musicCount?: number;
  description?: string;
  info?: string;
  sourceType?: number;
  userName?: string;
  userInfo?: { nickname?: string };
}

export interface BdPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export type BdSongUrlResult =
  | { available: true; url: string; isTrial: boolean; format: string }
  | { available: false; errorCode: ErrorCode };
