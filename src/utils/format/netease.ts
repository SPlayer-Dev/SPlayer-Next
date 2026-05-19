import type { Album, Artist, AudioQuality, Playlist, Track, TrackFee } from "@shared/types/player";
import type { UserSubcount } from "@/types/user";
import type { NeteaseSong } from "@/types/netease";

interface NeteaseError {
  code?: number;
  message?: string;
  msg?: string;
}

/**
 * 校验网易云接口响应
 * code !== 200 时抛 Error，message 取自 body.message / body.msg
 */
export const ensureOk = <T>(body: T): T => {
  const meta = body as NeteaseError | null | undefined;
  if (!meta || meta.code !== 200) {
    throw new Error(meta?.message ?? meta?.msg ?? "");
  }
  return body;
};

/**
 *  fee → 应用层 TrackFee
 *  fee：0=免费 1=VIP 4=购买专辑 8=会员高音质（视作 VIP）
 * @param fee - 原始 fee
 */
const toTrackFee = (fee: number | undefined): TrackFee | undefined => {
  if (fee === 0) return 0;
  if (fee === 1 || fee === 8) return 1;
  if (fee === 4) return 2;
  return undefined;
};

/**
 * 给封面 URL 拼尺寸
 * @param url - 封面原始 URL
 * @param size - 期望像素边长，默认 300
 */
export const withPicSize = (url: string | undefined, size = 300): string | undefined => {
  if (!url) return undefined;
  if (url.includes("?param=")) return url;
  return `${url}?param=${size}y${size}`;
};

/**
 * 根据 song 对象选择最佳音质
 * @param song - 原始 song 对象
 * @returns 最佳音质
 */
const pickQuality = (song: NeteaseSong): AudioQuality | undefined => {
  if (song.hr) {
    return {
      codec: "flac",
      sampleRate: Math.max(song.hr.sr ?? 0, 96000),
      bitsPerSample: 24,
      bitRate: song.hr.br,
      channels: 2,
    };
  }
  if (song.sq) {
    return {
      codec: "flac",
      sampleRate: song.sq.sr,
      bitsPerSample: 16,
      bitRate: song.sq.br,
      channels: 2,
    };
  }
  const mp3 = song.h ?? song.m ?? song.l;
  if (mp3) {
    return {
      codec: "mp3",
      sampleRate: mp3.sr,
      bitsPerSample: 16,
      bitRate: mp3.br,
      channels: 2,
    };
  }
  return undefined;
};

/**
 *  song → 应用层 Track
 * @param song - 原始 song 对象
 */
export const songToTrack = (song: NeteaseSong): Track => {
  const cover = withPicSize(song.al?.picUrl);
  const coverOriginal = withPicSize(song.al?.picUrl, 1024);
  const comment = song.alia?.find((s) => s?.trim()) ?? undefined;
  return {
    id: String(song.id),
    source: "netease",
    title: song.name,
    comment,
    artists: (song.ar ?? []).map((artist) => ({ id: String(artist.id), name: artist.name })),
    album: song.al ? { id: String(song.al.id), name: song.al.name, cover } : undefined,
    duration: song.dt ?? 0,
    cover,
    coverOriginal,
    quality: pickQuality(song),
    fee: toTrackFee(song.fee),
    cloud: song.pc != null ? true : undefined,
  };
};

/**
 *  songs 列表 → Track 列表，空/缺省安全
 * @param songs - 接口返回的 songs 数组
 */
export const songsToTracks = (songs: NeteaseSong[] | undefined | null): Track[] =>
  songs?.map(songToTrack) ?? [];

/**
 * 歌单条目 → 应用层 Playlist
 * 适用 `/user/playlist` 与 `/playlist/detail` 的 playlist 字段
 */
export const toPlaylist = (raw: any): Playlist => ({
  id: String(raw.id),
  name: raw.name,
  cover: withPicSize(raw.coverImgUrl),
  description: raw.description,
  trackCount: raw.trackCount,
  owner: raw.creator?.nickname,
});

/** 收藏专辑（/album/sublist 元素）→ 应用层 Album */
export const toAlbum = (raw: any): Album => ({
  id: String(raw.id),
  name: raw.name,
  cover: withPicSize(raw.picUrl),
  artist: raw.artists?.map((a: { name: string }) => a.name).join(" / ") ?? raw.artist?.name,
  trackCount: raw.size,
  year: raw.publishTime ? new Date(raw.publishTime).getFullYear() : undefined,
});

/** 收藏歌手（/artist/sublist 元素）→ 应用层 Artist */
export const toArtist = (raw: any): Artist => ({
  id: String(raw.id),
  name: raw.name,
  avatar: withPicSize(raw.img1v1Url ?? raw.picUrl),
  albumCount: raw.albumSize,
});

/** 订阅计数（/user/subcount）→ 应用层 UserSubcount */
export const toSubcount = (raw: any): UserSubcount => ({
  createdPlaylistCount: raw.createdPlaylistCount ?? 0,
  subPlaylistCount: raw.subPlaylistCount ?? 0,
  artistCount: raw.artistCount ?? 0,
});
