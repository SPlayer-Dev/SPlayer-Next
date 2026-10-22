import { decodeName, fillCover } from "./config";
import type { KGSong, Quality } from "@shared/types/platform/kugou";

export interface KGAudioInfo {
  hash?: string;
  hash_128?: string;
  hash_320?: string;
  hash_flac?: string;
  hash_high?: string;
  filesize?: number;
  filesize_128?: number;
  filesize_320?: number;
  filesize_flac?: number;
  filesize_high?: number;
  duration?: number;
  duration_128?: number;
  duration_320?: number;
  duration_flac?: number;
  duration_high?: number;
  timelength?: number;
  timelength_128?: number;
  timelength_320?: number;
  timelength_flac?: number;
  timelength_high?: number;
}

/** 专辑接口的歌曲结构，也是其他列表归一化时的公共输入 */
export interface KGResourceSong {
  base?: {
    audio_id?: number;
    audio_name?: string;
    album_id?: string | number;
    author_name?: string;
    album_audio_id?: number;
  };
  audio_info?: KGAudioInfo;
  authors?: Array<{ author_id?: string | number; author_name?: string }>;
  album_info?: { album_name?: string; cover?: string };
  trans_param?: { union_cover?: string };
  deprecated?: {
    pay_type?: number;
    pkg_price?: number;
    price?: number;
    feetype?: number;
  };
  copyright?: { privilege?: number };
}

interface SongDefaults {
  albumId?: string;
  albumName?: string;
  cover?: string;
}

/**
 * 统一歌单、专辑和歌手接口的歌曲身份、音质及展示字段
 * @param raw - 适配为资源结构的歌曲
 * @param defaults - 集合中已知的专辑信息
 * @returns 时长为毫秒的 KG 歌曲
 */
export const normalizeKGSong = (raw: KGResourceSong, defaults: SongDefaults = {}): KGSong => {
  const base = raw.base ?? {};
  const audio = raw.audio_info ?? {};
  const cover = raw.album_info?.cover || raw.trans_param?.union_cover || defaults.cover;
  const duration =
    audio.timelength_128 ||
    audio.timelength ||
    audio.timelength_320 ||
    audio.timelength_flac ||
    audio.timelength_high ||
    audio.duration_128 ||
    audio.duration ||
    audio.duration_320 ||
    audio.duration_flac ||
    audio.duration_high ||
    0;
  const hashes: Partial<Record<Quality, string>> = {};
  const sizes: Partial<Record<Quality, number>> = {};
  const variants: Array<[Quality, string | undefined, number | undefined]> = [
    ["128k", audio.hash_128 || audio.hash, audio.filesize_128 || audio.filesize],
    ["320k", audio.hash_320, audio.filesize_320],
    ["flac", audio.hash_flac, audio.filesize_flac],
    ["flac24bit", audio.hash_high, audio.filesize_high],
  ];
  for (const [quality, hash, size] of variants) {
    if (hash && size) {
      hashes[quality] = hash;
      sizes[quality] = size;
    }
  }

  const authors = raw.authors?.filter((author) => author.author_name);
  const artists = authors?.length
    ? authors.map((author) => ({
        id: author.author_id || undefined,
        name: decodeName(author.author_name),
      }))
    : (base.author_name || "")
        .split("、")
        .filter(Boolean)
        .map((name) => ({ id: undefined, name: decodeName(name.trim()) }));
  const hash = audio.hash_128 || audio.hash || "";

  return {
    id: String(base.audio_id || hash),
    audioId: base.audio_id ?? 0,
    albumAudioId: base.album_audio_id,
    hash,
    name: decodeName(base.audio_name),
    artist: artists.map((artist) => artist.name).join(" / "),
    artistId: artists[0]?.id,
    artists,
    album: decodeName(raw.album_info?.album_name || defaults.albumName),
    albumId: Number(base.album_id) > 0 ? String(base.album_id) : defaults.albumId || "",
    cover: fillCover(cover, 300),
    coverOriginal: fillCover(cover, 480),
    interval: duration / 1000,
    duration,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.deprecated?.pay_type ?? 0,
      privilege: raw.copyright?.privilege,
      pkg_price: raw.deprecated?.pkg_price,
      price: raw.deprecated?.price,
      feetype: raw.deprecated?.feetype,
    },
  };
};
