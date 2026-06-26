/**
 * 歌词渲染引擎 — 静态行逐字 timing 合成
 *
 * LRC 格式歌词只有行级 timing（每行 1 个 word），渲染时被判定为 static，
 * 无逐字扫字动画。此模块在整首歌词都是单 word 行时，按字符切分文本并
 * 均匀分配时间，让 LRC 也能呈现扫字效果。
 *
 * 仅影响引擎渲染，不修改 media store / 主进程同步的原始数据。
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";

/** CJK 统一表意文字 + 平假名 + 片假名 */
const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;

/**
 * 将文本切分为渲染段
 * CJK 文本逐字切分；拉丁/其他文本按空格切分并保留空格
 * @param text - 原始文本
 * @returns 切分后的段数组
 */
const splitToSegments = (text: string): string[] => {
  if (!text) return [];
  if (CJK_REGEX.test(text)) {
    return Array.from(text);
  }
  // 英文按空格切分，保留空格让渲染间距自然
  return text.split(/(\s+)/).filter((s) => s.length > 0);
};

/**
 * 为静态行（单 word）合成逐字 timing
 * 仅当整首歌词都是单 word 行时触发；任一行有多 word 则原样返回
 * @param lines - 原始歌词行
 * @returns 合成后的歌词行（浅拷贝，不修改原始数据）
 */
export const synthesizeWordsIfNeeded = (lines: LyricLine[]): LyricLine[] => {
  const hasMultiWordLine = lines.some((line) => line.words.length > 1);
  if (hasMultiWordLine) return lines;

  return lines.map((line) => {
    if (line.words.length === 0) return line;
    // 无有效时间区间的行（如间奏占位）不合成
    if (line.endTime <= line.startTime) return line;

    const text = line.words[0].word;
    if (!text || text.length <= 1) return line;

    const segments = splitToSegments(text);
    if (segments.length <= 1) return line;

    const duration = line.endTime - line.startTime;
    const segmentDuration = duration / segments.length;

    const words: LyricWord[] = segments.map((seg, i) => ({
      startTime: line.startTime + i * segmentDuration,
      endTime: line.startTime + (i + 1) * segmentDuration,
      word: seg,
    }));

    return { ...line, words };
  });
};
