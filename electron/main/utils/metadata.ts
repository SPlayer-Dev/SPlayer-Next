import { pathToFileURL } from "node:url";
import type { Artist, Album, Track } from "@shared/types/player";

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
 * 提取歌手名称数组
 * @param artists - Artist 数组
 * @returns 名称数组，已去除空白与空项
 */
export const artistNames = (artists: Artist[]): string[] => {
  // 已缓存的云盘歌曲可能包含空歌手名称，不能因此中断播放
  return artists.map((artist) => artist.name?.trim()).filter((name): name is string => !!name);
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

/**
 * 根据曲目信息与音源路径解析适合向 MPRIS 输出的标准 xesam:url
 * 兼顾网易云、QQ 音乐、酷狗、本地文件等各平台格式
 * @param authoritative - 曲目权威信息
 * @param source - 音频加载路径或网络源
 * @returns 适合向 MPRIS 暴露的规范 URL，流媒体或无法确定公共地址时返回 undefined
 */
export const resolveTrackMprisUrl = (
  authoritative: Track | null,
  source: string,
): string | undefined => {
  if (authoritative) {
    switch (authoritative.source) {
      case "netease":
        return `https://music.163.com/song?id=${encodeURIComponent(authoritative.id)}`;
      case "qqmusic":
        return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(authoritative.id)}`;
      case "kugou":
        return `https://www.kugou.com/song/#hash=${encodeURIComponent(authoritative.id)}`;
      case "local": {
        const filePath =
          authoritative.cueAudioPath ||
          (authoritative.path?.startsWith("cue://") ? undefined : authoritative.path) ||
          source;
        if (filePath && !filePath.startsWith("cue://") && !/^https?:\/\//i.test(filePath)) {
          try {
            return pathToFileURL(filePath).toString();
          } catch {
            return `file://${filePath}`;
          }
        }
        break;
      }
      case "streaming":
        // 流媒体直链通常带有用户认证密钥或会话令牌（如 Subsonic u/t、Jellyfin api_key），避免向 D-Bus 总线广播凭据
        return undefined;
      case "plugin":
        if (authoritative.plugin?.source && /^https?:\/\//i.test(authoritative.plugin.source)) {
          return authoritative.plugin.source;
        }
        break;
    }
  }

  if (source && !/^https?:\/\//i.test(source) && !source.startsWith("cue://")) {
    try {
      return pathToFileURL(source).toString();
    } catch {
      return `file://${source}`;
    }
  }

  return undefined;
};
