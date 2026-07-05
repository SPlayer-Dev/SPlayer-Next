import type { Track } from "@shared/types/player";

/** DJ 模式关键词 */
const DJ_KEYWORDS = ["DJ", "抖音", "0.9", "0.8", "网红", "车载", "热歌", "慢摇"];

/**
 * 检查歌曲是否应被跳过
 * @param track - 歌曲信息
 */
export const shouldSkipDjTrack = (track: Track): boolean => {
  const name = (track.title || "").toUpperCase();
  const artistNames = (track.artists || [])
    .map((a) => a.name)
    .join(" ")
    .toUpperCase();
  const fullText = `${name} ${artistNames}`;
  return DJ_KEYWORDS.some((k) => fullText.includes(k.toUpperCase()));
};
