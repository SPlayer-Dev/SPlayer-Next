import type { Track } from "@shared/types/player";

/** 默认跳过关键词列表 */
export const DEFAULT_SKIP_TRACK_KEYWORDS: readonly string[] = [
  "DJ",
  "抖音",
  "0.9",
  "0.8",
  "网红",
  "车载",
  "热歌",
  "慢摇",
];

/**
 * 检查歌曲是否命中指定关键词需要跳过
 * @param track - 歌曲信息
 * @param keywords - 关键词列表
 */
export const shouldSkipKeywordTrack = (
  track: Track,
  keywords: readonly string[] = DEFAULT_SKIP_TRACK_KEYWORDS,
): boolean => {
  if (!keywords || keywords.length === 0) return false;
  const name = (track.title || "").toUpperCase();
  const artistNames = (track.artists || [])
    .map((a) => a.name)
    .join(" ")
    .toUpperCase();
  const fullText = `${name} ${artistNames}`;
  return keywords.some((k) => {
    const trimmed = k.trim();
    return trimmed ? fullText.includes(trimmed.toUpperCase()) : false;
  });
};
