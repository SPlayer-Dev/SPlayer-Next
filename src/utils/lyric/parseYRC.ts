/**
 * YRC 逐字歌词解析器
 *
 * 格式：
 *   [start_ms,dur_ms](start_ms,dur_ms,0)文字(start_ms,dur_ms,0)文字...
 *   - 行头 [起始, 时长]（绝对毫秒，与 QRC 一致）
 *   - 字级 (起始毫秒, 时长毫秒, 0)文字  —— 时间在前，文字在后（与 QRC 相反）
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { splitTrailingBackground } from "./bg";

/** 行头：[起始毫秒, 时长毫秒] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** 字级：(起始毫秒, 时长毫秒, 0)文字 */
const WORD_RE = /\((\d+),(\d+),\d+\)([^(]*)/g;

/**
 * 解析 YRC 逐字
 * 格式：文字(start,dur,0)文字(start,dur,0)...
 * @param content 去掉行首时间戳后的内容
 * @returns 解析出的单词数组
 */
const parseYrcWords = (content: string): LyricWord[] => {
  const words: LyricWord[] = [];

  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(content)) !== null) {
    const start = parseInt(match[1], 10);
    const dur = parseInt(match[2], 10);
    const word = match[3];

    if (word) {
      words.push({ word, startTime: start, endTime: start + dur });
    }
  }

  if (words.length === 0) return [];

  // 填充每个单词的 endTime
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].endTime <= words[i].startTime) {
      words[i].endTime = words[i + 1].startTime;
    }
  }
  if (words.length > 0 && words[words.length - 1].endTime <= words[words.length - 1].startTime) {
    words[words.length - 1].endTime = words[words.length - 1].startTime + 100;
  }

  return words;
};

/** 解析 YRC 歌词 */
export const parseYRC = (text: string, detectBackground = true): LyricLine[] => {
  const lines: LyricLine[] = [];

  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;

    const lineStart = parseInt(header[1], 10);
    const lineDur = parseInt(header[2], 10);
    const rest = trimmed.slice(header[0].length);

    // 在逐字解析之前，从原始 rest 提取最后一个时间戳后的括号内容作为背景
    let lastTimingEnd = -1;
    let timingMatch: RegExpExecArray | null;
    const timingReYrc = /\(\d+,\d+,\d+\)/g;
    while ((timingMatch = timingReYrc.exec(rest)) !== null) {
      lastTimingEnd = timingMatch.index + timingMatch[0].length;
    }
    let backgroundWord = "";
    if (lastTimingEnd !== -1 && lastTimingEnd < rest.length) {
      const afterLastTiming = rest.slice(lastTimingEnd).trim();
      // 过滤空括号，保留有效背景
      const filtered = afterLastTiming.replace(/\(\s*\)/g, "").trim();
      if (filtered) {
        const parenMatch = filtered.match(/^[（(]\s*([^）)]+)\s*[）)]$/);
        if (parenMatch) {
          const candidate = parenMatch[1].trim();
          if (candidate) {
            backgroundWord = candidate;
          }
        }
      }
    }

    const words = parseYrcWords(rest);

    if (words.length === 0) continue;

    const line: LyricLine = {
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lineStart + lineDur,
      isBG: false,
      isDuet: false,
    };
    lines.push(line);

    // 如果有提取到的背景词，添加为背景行
    if (backgroundWord) {
      const bgWords: LyricWord[] = [
        { word: backgroundWord, startTime: lineStart, endTime: lineStart + lineDur },
      ];
      lines.push({
        words: bgWords,
        translatedLyric: "",
        romanLyric: "",
        startTime: lineStart,
        endTime: lineStart + lineDur,
        isBG: true,
        isDuet: false,
      });
    }

    // 行内尾随和声「主歌词（和声）」拆成紧随的背景行
    if (!line.isBG) {
      const trailingBg = splitTrailingBackground(line, detectBackground);
      if (trailingBg) lines.push(trailingBg);
    }
  }

  return lines;
};
