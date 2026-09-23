import type { AudioQuality, Track, TrackFee } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";

export interface KGSong {
  id: string;
  audioId?: number;
  albumAudioId?: number;
  hash: string;
  name: string;
  artist: string;
  artistId?: string | number;
  artists?: Array<{ id?: string | number; name: string }>;
  album?: string;
  albumId?: string | number;
  cover?: string;
  coverOriginal?: string;
  interval?: number;
  duration: number;
  qualities?: string[];
  hashes?: Partial<Record<string, string>>;
  sizes?: Partial<Record<string, number>>;
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
  artist?: string;
  artistId?: string;
  trackCount?: number;
  publishTime?: string;
  intro?: string;
}

export interface KGArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
  songCount?: number;
  fansCount?: number;
}

export interface KGPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator?: string;
  trackCount?: number;
  playCount?: number;
}

/**
 * 将 KG 付费标识转换为应用层等级
 * 0: 免费
 * 1: VIP
 * 4: 数字专辑 (EP)
 * @param song - KG 歌曲
 * @returns 付费等级
 */
const kgTrackFee = (song: KGSong): TrackFee => {
  const payType = song.pay?.payplay ?? 0;
  const privilege = song.pay?.privilege ?? 0;
  const feeType = song.pay?.feetype ?? 0;
  const pkgPrice = song.pay?.pkg_price ?? 0;
  const price = song.pay?.price ?? 0;

  // 必须单独购买且不可通过 VIP 包月畅听 (pkg_price === 0 && price > 0)，或独立数字专辑 (pay_type === 2 或 feetype === 1)
  if (feeType === 1 || payType === 2 || (pkgPrice === 0 && price > 0)) {
    return 4;
  }

  // VIP 会员专享
  if (payType === 1 || payType === 3 || privilege >= 8) {
    return 1;
  }

  return 0;
};

/**
 * 标准化歌曲时长为毫秒
 * @param duration - 时长（可能是秒或毫秒）
 * @param interval - 时长（秒）
 * @returns 统一毫秒数
 */
export const normalizeDurationMs = (duration?: number, interval?: number): number => {
  if (duration !== undefined && duration > 0) {
    if (interval && interval > 0 && duration === interval) {
      return interval * 1000;
    }
    if (duration < 10000) {
      return duration * 1000;
    }
    return duration;
  }
  if (interval !== undefined && interval > 0) {
    return interval * 1000;
  }
  return 0;
};

/**
 * 根据 KG 搜索结果选择最高可用音质
 * @param song - KG 歌曲
 * @param durationMs - 歌曲毫秒时长
 * @returns 音质和对应文件大小
 */
const kgTrackQuality = (
  song: KGSong,
  durationMs: number,
): { quality: AudioQuality; fileSize: number } | undefined => {
  const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;
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

  const sizes = song.sizes;
  if (sizes?.flac24bit) return create("flac", sizes.flac24bit, 0, 24, 96000);
  if (sizes?.flac) return create("flac", sizes.flac, 0, 16);
  if (sizes?.["320k"]) return create("mp3", sizes["320k"], 320000, 16);
  if (sizes?.["128k"]) return create("mp3", sizes["128k"], 128000, 16);
  return undefined;
};

/**
 * 将 KG 歌曲转换为统一 Track 对象
 * @param song - KG 歌曲对象
 * @returns Track 实例
 */
export const kgSongToTrack = (song: KGSong): Track => {
  const durationMs = normalizeDurationMs(song.duration, song.interval);
  const audio = kgTrackQuality(song, durationMs);

  const artists = song.artists?.length
    ? song.artists.map((a) => ({
        id: a.id !== undefined ? String(a.id) : a.name || undefined,
        name: a.name,
      }))
    : song.artist
      ? [
          {
            id: song.artistId !== undefined ? String(song.artistId) : song.artist,
            name: song.artist,
          },
        ]
      : [];

  return {
    id: song.hash || song.id,
    extId: String(song.albumAudioId ?? song.id),
    source: "kugou",
    title: song.name,
    artists,
    album: song.album
      ? {
          id: song.albumId ? String(song.albumId) : undefined,
          name: song.album,
          cover: song.cover,
        }
      : undefined,
    duration: durationMs,
    quality: audio?.quality,
    fileSize: audio?.fileSize,
    fee: kgTrackFee(song),
    cover: song.cover,
    coverOriginal: song.coverOriginal,
  };
};

/**
 * 将 KG 歌曲列表批量转换为统一 Track 列表
 * @param songs - KG 歌曲数组
 * @returns Track 数组
 */
export const kgSongsToTracks = (songs: KGSong[] | undefined): Track[] =>
  songs?.map(kgSongToTrack) ?? [];

/**
 * 将 KG 专辑转换为 CoverItem
 * @param album - KG 专辑
 * @returns CoverItem
 */
export const kgAlbumToCoverItem = (album: KGAlbumItem): CoverItem => ({
  id: album.id,
  title: album.name,
  cover: album.cover,
  subtitle: album.artist ?? "",
  trackCount: album.trackCount ?? 0,
});

/**
 * 将 KG 歌手转换为 CoverItem
 * @param artist - KG 歌手
 * @returns CoverItem
 */
export const kgArtistToCoverItem = (artist: KGArtistItem): CoverItem => ({
  id: artist.id,
  title: artist.name,
  cover: artist.cover,
  subtitle: "",
  trackCount: artist.albumCount ?? 0,
});

/**
 * 将 KG 歌单转换为 CoverItem
 * @param playlist - KG 歌单
 * @returns CoverItem
 */
export const kgPlaylistToCoverItem = (playlist: KGPlaylistItem): CoverItem => ({
  id: playlist.id,
  title: playlist.name,
  cover: playlist.cover,
  subtitle: playlist.creator ?? "",
  trackCount: playlist.trackCount ?? 0,
});
