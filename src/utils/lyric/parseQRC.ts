/**
 * QRC 逐字歌词解析器
 *
 * 格式（解密后）：
 *   [start_ms,dur_ms]文字(start_ms,dur_ms)文字(start_ms,dur_ms)...
 *   - 行头 [起始, 时长]（绝对毫秒）
 *   - 字级 文字(绝对起始, 时长)
 *
 * 额外支持 XML 包裹：`LyricContent="..."` 属性 或 `<![CDATA[...]]>` 段
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { detectBackgroundLine, splitTrailingBackground } from "./bg";

/** 行头：[起始毫秒, 时长毫秒] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** 时间标记开头：`(` 紧跟数字 */
const TIMING_RE = /\((\d+),(\d+)\)/;

/**
 * 逐字符解析单行 QRC 字级歌词
 *
 * QRC 格式中文本与时间标记交替出现：`text(start,dur)text(start,dur)...`
 * 文本可包含任意字符（含 `(` 和 `)`），只有 `(` 后紧跟数字才是时间标记
 */
const parseWords = (rest: string): LyricWord[] => {
  const words: LyricWord[] = [];
  let pos = 0;

  while (pos < rest.length) {
    // 查找下一个时间标记 `(\d`，跳过作为文本的 `(`（后跟非数字）
    let timingIdx = rest.indexOf("(", pos);
    while (timingIdx !== -1 && timingIdx + 1 < rest.length && !/\d/.test(rest[timingIdx + 1])) {
      timingIdx = rest.indexOf("(", timingIdx + 1);
    }
    if (timingIdx === -1 || timingIdx + 1 >= rest.length) break;

    // 提取时间标记
    const timingSub = rest.slice(timingIdx);
    const timingMatch = TIMING_RE.exec(timingSub);
    if (!timingMatch) break;

    const start = parseInt(timingMatch[1], 10);
    const dur = parseInt(timingMatch[2], 10);

    // 被跳过的 `(` 是文本中的括号，作为独立字保留
    for (let i = pos; i < timingIdx; i++) {
      if (rest[i] === "(") {
        words.push({ word: "(", startTime: start, endTime: start + dur });
      }
    }

    // 时间标记前的文本作为 word 内容（排除已处理的 `(`）
    const wordText = rest.slice(pos, timingIdx).replace(/\(/g, "");
    if (wordText) {
      words.push({ word: wordText, startTime: start, endTime: start + dur });
    }

    pos = timingIdx + timingMatch[0].length;

    // 时间标记后紧跟的 `)` 是文本括号的闭合，保留为独立字
    if (pos < rest.length && rest[pos] === ")") {
      words.push({ word: ")", startTime: start, endTime: start + dur });
      pos++;
    }
  }

  return words;
};

/** 从 XML 包裹中提取纯文本歌词内容（非 XML 原样返回） */
const extractFromXml = (text: string): string => {
  if (!text.trimStart().startsWith("<")) return text;
  const greedyMatch = text.match(/LyricContent="([\s\S]*)"\s*\/?>/);
  if (greedyMatch) return greedyMatch[1];
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) return cdataMatch[1];
  const attrMatch = text.match(/LyricContent="([^"]*)"/);
  if (attrMatch) return attrMatch[1];
  return text;
};

/** 解析 QRC 歌词 */
export const parseQRC = (text: string, detectBackground = true): LyricLine[] => {
  const content = extractFromXml(text);
  const lines: LyricLine[] = [];

  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;

    const lineStart = parseInt(header[1], 10);
    const lineDur = parseInt(header[2], 10);
    const rest = trimmed.slice(header[0].length);

    const words = parseWords(rest);

    if (words.length === 0) continue;

    const line: LyricLine = {
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lineStart + lineDur,
      isBG: detectBackgroundLine(words, detectBackground),
      isDuet: false,
    };
    lines.push(line);
    // 行内尾随和声「主歌词（和声）」拆成紧随的背景行
    if (!line.isBG) {
      const bg = splitTrailingBackground(line, detectBackground);
      if (bg) lines.push(bg);
    }
  }

  return lines;
};
