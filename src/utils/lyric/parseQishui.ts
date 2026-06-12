/**
 * 汽水音乐(QS)逐字歌词解析器
 *
 * 格式：
 *   [行起ms,行长ms]<字偏移ms,字时长ms,0>字<...>字...
 *   - 行头 [起始, 时长]：绝对毫秒（与 QRC/YRC 一致）
 *   - 字级 <相对行首偏移, 时长, 0>字：前缀、尖括号、三字段（第三字段恒 0、忽略）
 *
 * 与 KRC 区别：行头是绝对毫秒（非 mm:ss）、字级三字段（非两字段）。
 * 与 YRC 区别：字级用尖括号、偏移相对行首（YRC 圆括号、绝对毫秒）。
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { detectBackgroundLine } from "./bg";

/** 行头：[起始毫秒, 时长毫秒] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** 字级：<相对偏移, 时长, 0>字（字为到下一个 `<` 或行尾前的所有字符） */
const WORD_RE = /<(\d+),(\d+),\d+>([^<]*)/g;

/** 解析汽水逐字歌词 */
export const parseQishui = (text: string): LyricLine[] => {
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
      const word = match[3];
      if (!word) continue;
      const start = lineStart + parseInt(match[1], 10);
      const dur = parseInt(match[2], 10);
      words.push({ word, startTime: start, endTime: start + dur });
    }

    if (words.length === 0) continue;

    lines.push({
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lineStart + lineDur,
      isBG: detectBackgroundLine(words),
      isDuet: false,
    });
  }

  return lines;
};
