import type { Artist, Album } from "@shared/types/player";

/** 常见的歌手分隔符：/ & ; , × | 、 ， feat. ft. */
const ARTIST_SEPARATOR = /\s*(?:feat\.?|ft\.?)\s+|[/&;,×|、，]\s*/i;

/**
 * 将歌手字符串按常见分隔符拆分为 Artist 数组
 * @param raw - 原始歌手字符串（可能含多个歌手，如 "周杰伦/林俊杰"）
 * @returns Artist 数组，空字符串返回空数组
 */
export const parseArtists = (raw: string): Artist[] => {
  if (!raw) return [];
  return raw
    .split(ARTIST_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
};

/**
 * 将 Artist 数组格式化为字符串
 * @param artists - Artist 数组
 * @param separator - 分隔符，默认 " / "
 * @returns 拼接后的字符串，空数组返回空字符串
 */
export const formatArtists = (artists: Artist[], separator = " / "): string => {
  return artists.map((artist) => artist.name).join(separator);
};

/**
 * 将专辑字符串转为 Album 对象
 * @param raw - 原始专辑名
 * @returns Album 对象，空字符串返回 undefined
 */
export const parseAlbum = (raw: string): Album | undefined => {
  const name = raw.trim();
  return name ? { name } : undefined;
};
