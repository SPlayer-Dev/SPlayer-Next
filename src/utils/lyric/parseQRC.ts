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
import { splitTrailingBackground } from "./bg";

/** 行头：[起始毫秒, 时长毫秒] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** 时间标记开头：`(` 紧跟数字 */
const TIMING_RE = /\((\d+),(\d+)\)/;

/**
 * 解析 QRC 逐字
 * 格式：文字(start,dur)文字(start,dur)...
 * @param content 去掉行首时间戳后的内容
 * @returns 解析出的单词数组，非逐字格式返回 null
 */
const parseQrcWords = (content: string): LyricWord[] | null => {
  const words: LyricWord[] = [];
  let pos = 0;

  while (pos < content.length) {
    // 查找下一个时间标记 `(\d`，跳过作为文本的 `(`（后跟非数字）
    let timingIdx = content.indexOf("(", pos);
    while (
      timingIdx !== -1 &&
      timingIdx + 1 < content.length &&
      !/\d/.test(content[timingIdx + 1])
    ) {
      timingIdx = content.indexOf("(", timingIdx + 1);
    }
    if (timingIdx === -1 || timingIdx + 1 >= content.length) break;

    // 提取时间标记
    const timingSub = content.slice(timingIdx);
    const timingMatch = TIMING_RE.exec(timingSub);
    if (!timingMatch) break;

    const start = parseInt(timingMatch[1], 10);
    const dur = parseInt(timingMatch[2], 10);

    // 被跳过的 `(` 是文本中的括号，作为独立字保留
    for (let i = pos; i < timingIdx; i++) {
      if (content[i] === "(") {
        words.push({ word: "(", startTime: start, endTime: start + dur });
      }
    }

    // 时间标记前的文本作为 word 内容（排除已处理的 `(`）
    const wordText = content.slice(pos, timingIdx).replace(/\(/g, "");
    if (wordText) {
      words.push({ word: wordText, startTime: start, endTime: start + dur });
    }

    pos = timingIdx + timingMatch[0].length;

    // 时间标记后紧跟的 `)` 是文本括号的闭合，保留为独立字
    if (pos < content.length && content[pos] === ")") {
      words.push({ word: ")", startTime: start, endTime: start + dur });
      pos++;
    }
  }

  if (words.length === 0) return null;

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

    // 在逐字解析之前，从原始 rest 提取最后一个时间戳后的括号内容作为背景
    let lastTimingEnd = -1;
    let timingMatch: RegExpExecArray | null;
    const timingReQrc = /\(\d+,\d+\)/g;
    while ((timingMatch = timingReQrc.exec(rest)) !== null) {
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

    const words = parseQrcWords(rest);

    if (!words) continue;

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
