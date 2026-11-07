/**
 * 候选歌词验证：只放行与基准同版本的第三方歌词
 */

import type { Track } from "@shared/types/player";
import type { LyricFormat, LyricLine } from "lyric-kit";

import { compareLyrics, parseLyric } from "lyric-kit";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";
import type { OnlineResult } from "./resolve";

/** 自动平移上限，偏移再大更可能是不同版本 */
const MAX_AUTO_SHIFT_MS = 10_000;

/**
 * 解析主歌词用于比较和判断逐字时间
 * @param format - 歌词格式
 * @param content - 歌词原文
 * @returns 歌词行，无法解析时为空数组
 */
export const parseMainLines = (format: LyricFormat, content: string): LyricLine[] => {
  try {
    return parseLyric({ content, format }).lines;
  } catch {
    return [];
  }
};

/**
 * 验证候选歌词是否与基准同版本
 * 误拒只会保留基准歌词，因此无法判断时一律不放行
 * @param baselineLines - 基准歌词行
 * @param candidateLines - 候选歌词行
 * @param candidate - 候选歌词
 * @param track - 歌曲信息
 * @returns 可用的候选歌词，需要平移时带上校正量；不通过时为 null
 */
export const verifyCandidate = async (
  baselineLines: LyricLine[],
  candidateLines: LyricLine[],
  candidate: OnlineResult,
  track: Track,
): Promise<OnlineResult | null> => {
  const options = {
    matchMetadata: { title: track.title, artists: track.artists.map((artist) => artist.name) },
  };
  let comparison = compareLyrics(baselineLines, candidateLines, options);
  if (comparison.verdict === "different") {
    // 平台间简繁不一致很常见，统一后再判断一次
    const [baseline, other] = await Promise.all([
      applyLyricCjkTransform(baselineLines, "t2s"),
      applyLyricCjkTransform(candidateLines, "t2s"),
    ]);
    comparison = compareLyrics(baseline, other, options);
  }
  if (comparison.verdict === "same") return candidate;
  if (comparison.verdict === "shifted" && Math.abs(comparison.offsetMs) <= MAX_AUTO_SHIFT_MS) {
    return { ...candidate, source: { ...candidate.source, timeShiftMs: -comparison.offsetMs } };
  }
  if (comparison.verdict === "different") {
    // 错误映射还会影响 TTML 和本地歌词库查询
    void window.api.lyrics.forgetMatch(track, candidate.source.platform);
  }
  return null;
};
