/**
 * KRC 逐字歌词解析器
 *
 * 主进程 `decodeKrc` 把原始加密 KRC 解密后输出的格式：
 *   [mm:ss.xxx]<offset_ms,dur_ms>字<offset_ms,dur_ms>字...
 * 行头为 LRC 式绝对时间戳，逐字部分是前缀式 `<相对行首偏移,时长>字`。
 *
 * 与 QRC 的区别：
 *   - QRC 行头 `[start_ms,dur_ms]` 是绝对毫秒；KRC 是 `[mm:ss.xxx]` LRC 式
 *   - QRC 字级 `字(start_ms,dur_ms)` 是后缀 + 绝对毫秒；KRC 是 `<offset,dur>字` 前缀 + 相对行首偏移
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { parseTime } from "./timestamp";
import { detectBackgroundLine } from "./bg";

/** 行头：[mm:ss.xxx] / [mm:ss:xxx]，支持 1~3 位毫秒 */
const LINE_HEADER_RE = /^\[(\d+):(\d+)[.:](\d{1,3})\]/;

/** 行内逐字：<offset,dur>字（字为到下一个 `<` 或行尾前的所有字符） */
const WORD_RE = /<(\d+),(\d+)>([^<]*)/g;

/** 解析 KRC 歌词 */
export const parseKRC = (text: string, detectBackground = true): LyricLine[] => {
  const lines: LyricLine[] = [];

  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;

    const lineStart = parseTime(header[1], header[2], header[3]);
    const rest = trimmed.slice(header[0].length);

    WORD_RE.lastIndex = 0;
    const words: LyricWord[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = lineStart;
    while ((match = WORD_RE.exec(rest)) !== null) {
      const word = match[3];
      if (!word) continue;
      const offset = parseInt(match[1], 10);
      const dur = parseInt(match[2], 10);
      const start = lineStart + offset;
      const end = start + dur;
      words.push({ word, startTime: start, endTime: end });
      lastEnd = Math.max(lastEnd, end);
    }

    if (words.length === 0) continue;

    lines.push({
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lastEnd,
      isBG: detectBackgroundLine(words, detectBackground),
      isDuet: false,
    });
  }

  return lines;
};
