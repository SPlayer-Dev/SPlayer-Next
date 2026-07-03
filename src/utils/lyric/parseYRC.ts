/**
 * YRC 逐字歌词解析器
 *
 * 格式：
 *   [start_ms,dur_ms](start_ms,dur_ms,0)文字(start_ms,dur_ms,0)文字...
 *   - 行头 [起始, 时长]（绝对毫秒，与 QRC 一致）
 *   - 字级 (起始毫秒, 时长毫秒, 0)文字  —— 时间在前，文字在后（与 QRC 相反）
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { detectBackgroundLine, splitTrailingBackground } from "./bg";

/** 行头：[起始毫秒, 时长毫秒] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** 字级：(起始毫秒, 时长毫秒, 0)文字 */
const WORD_RE = /\((\d+),(\d+),\d+\)([^(]*)/g;

/** 解析 YRC 歌词 */
export const parseYRC = (text: string): LyricLine[] => {
  const lines: LyricLine[] = [];

  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;

    const lineStart = parseInt(header[1], 10);
    const lineDur = parseInt(header[2], 10);
    const rest = trimmed.slice(header[0].length);

    WORD_RE.lastIndex = 0;
    const words: LyricWord[] = [];
    let match: RegExpExecArray | null;
    while ((match = WORD_RE.exec(rest)) !== null) {
      const start = parseInt(match[1], 10);
      const dur = parseInt(match[2], 10);
      words.push({ word: match[3], startTime: start, endTime: start + dur });
    }

    if (words.length === 0) continue;

    const line: LyricLine = {
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lineStart + lineDur,
      isBG: detectBackgroundLine(words),
      isDuet: false,
    };
    lines.push(line);
    // 行内尾随和声「主歌词（和声）」拆成紧随的背景行
    if (!line.isBG) {
      const bg = splitTrailingBackground(line);
      if (bg) lines.push(bg);
    }
  }

  return lines;
};
