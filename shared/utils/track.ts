import type { Artist } from "../types/player";

/**
 * 获取有效的歌手记录
 * @param artists - 歌手数组
 * @returns 过滤掉 name 为空的歌手记录
 */
export const getValidArtists = (artists?: Artist[]): Artist[] =>
  (artists ?? []).filter((artist) => artist.name.trim().length > 0);

/**
 * 格式化歌手名称。
 * @param artists - 歌手数组
 * @param separator - 分隔符，默认 " / "
 * @returns 拼接后的歌手名称字符串
 */
export const formatArtists = (artists?: Artist[], separator = " / "): string =>
  getValidArtists(artists)
    .map((artist) => artist.name.trim())
    .join(separator);
