import type { AudioQuality, Track, TrackFee } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";

export interface QMSong {
  id: string;
  mid?: string;
  mediaMid?: string;
  name: string;
  artist: string;
  artists?: Array<{ mid?: string; name?: string }>;
  album?: string;
  albumMid?: string;
  cover?: string;
  coverOriginal?: string;
  duration: number;
  pay?: {
    payalbum?: number;
    payplay?: number;
  };
  size128?: number;
  size320?: number;
  sizeApe?: number;
  sizeFlac?: number;
  sizeOgg?: number;
  sizeHiRes?: number;
  hiResSampleRate?: number;
  hiResBitDepth?: number;
}

export interface QMAlbumItem {
  id: string;
  name: string;
  cover?: string;
  artist?: string;
  trackCount?: number;
}

export interface QMArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
  songCount?: number;
}

export interface QMPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator?: string;
  trackCount?: number;
}

export const qqAlbumCover = (mid: string, size = 300): string =>
  `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;

export const qqArtistCover = (mid: string, size = 300): string =>
  `https://y.gtimg.cn/music/photo_new/T001R${size}x${size}M000${mid}.jpg`;

/**
 * 将 QM 付费标识转换为应用层等级
 * @param song - QM 歌曲
 * @returns 付费等级
 */
const qqTrackFee = (song: QMSong): TrackFee => {
  if (song.pay?.payalbum === 1) return 4;
  if (song.pay?.payplay === 1) return 1;
  return 0;
};

/**
 * 根据 QM 搜索结果选择最高可用音质
 * @param song - QM 歌曲
 * @returns 音质和对应文件大小
 */
const qqTrackQuality = (song: QMSong): { quality: AudioQuality; fileSize: number } | undefined => {
  const durationSeconds = song.duration / 1000;
  const create = (
    codec: string,
    fileSize: number,
    bitRate: number,
    bitsPerSample: number,
    sampleRate = 44100,
  ) => ({
    fileSize,
    quality: {
      codec,
      sampleRate,
      channels: 2,
      bitsPerSample,
      bitRate: bitRate || (durationSeconds > 0 ? Math.round((fileSize * 8) / durationSeconds) : 0),
    },
  });
  if (song.sizeHiRes) {
    return create(
      "flac",
      song.sizeHiRes,
      0,
      song.hiResBitDepth || 24,
      song.hiResSampleRate || 96000,
    );
  }
  if (song.sizeFlac) return create("flac", song.sizeFlac, 0, 16);
  if (song.sizeApe) return create("ape", song.sizeApe, 0, 16);
  if (song.size320) return create("mp3", song.size320, 320000, 16);
  if (song.sizeOgg) return create("ogg", song.sizeOgg, 0, 16);
  if (song.size128) return create("mp3", song.size128, 128000, 16);
  return undefined;
};

export const qqSongToTrack = (song: QMSong): Track => {
  const cover = song.cover || (song.albumMid ? qqAlbumCover(song.albumMid) : undefined);
  const audio = qqTrackQuality(song);
  return {
    id: song.mid || song.id,
    extId: song.mid && song.id !== song.mid ? song.id : undefined,
    mediaId: song.mediaMid || undefined,
    source: "qqmusic",
    title: song.name,
    artists: song.artists?.length
      ? song.artists.map((artist) => ({ id: artist.mid, name: artist.name ?? "" }))
      : song.artist
        ? [{ name: song.artist }]
        : [],
    album: song.album ? { id: song.albumMid, name: song.album, cover } : undefined,
    duration: song.duration ?? 0,
    quality: audio?.quality,
    fileSize: audio?.fileSize,
    fee: qqTrackFee(song),
    cover,
    coverOriginal:
      song.coverOriginal || (song.albumMid ? qqAlbumCover(song.albumMid, 800) : undefined),
  };
};

export const qqSongsToTracks = (songs: QMSong[] | undefined): Track[] =>
  songs?.map(qqSongToTrack) ?? [];

export const qqAlbumToCoverItem = (album: QMAlbumItem): CoverItem => ({
  id: album.id,
  title: album.name,
  cover: album.cover,
  subtitle: album.artist ?? "",
  trackCount: album.trackCount ?? 0,
});

export const qqArtistToCoverItem = (artist: QMArtistItem): CoverItem => ({
  id: artist.id,
  title: artist.name,
  cover: artist.cover,
  subtitle: "",
  trackCount: artist.albumCount ?? 0,
});

export const qqPlaylistToCoverItem = (playlist: QMPlaylistItem): CoverItem => ({
  id: playlist.id,
  title: playlist.name,
  cover: playlist.cover,
  subtitle: playlist.creator ?? "",
  trackCount: playlist.trackCount ?? 0,
});
