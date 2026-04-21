/**
 * QRC / YRC 逐字歌词解析器
 *
 * 两种格式共享相同的行头结构 [起始ms,时长ms]，仅逐字部分的排列顺序不同：
 * - QRC（QQ 音乐）：文字(起始ms,时长ms) → 文字在前，时间在后
 * - YRC (Netease)：(起始ms,时长ms,0)文字 → 时间在前，文字在后
 *
 * QRC 额外支持 XML 包裹（LyricContent 属性或 CDATA 段）
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";

/** 匹配行头时间戳 [起始ms,时长ms] */
const LINE_HEADER_RE = /^\[(\d+),(\d+)\]/;

/** QRC 逐字：文字(起始ms,时长ms) */
const QRC_WORD_RE = /([^(]+)\((\d+),(\d+)\)/g;

/** YRC 逐字：(起始ms,时长ms,0)文字 */
const YRC_WORD_RE = /\((\d+),(\d+),\d+\)([^(]*)/g;

/**
 * 从 XML 包裹中提取纯文本歌词内容
 * @param text 原始文本
 * @returns 提取出的纯文本歌词，非 XML 格式则原样返回
 */
const extractFromXml = (text: string): string => {
  if (!text.trimStart().startsWith("<")) return text;
  // 尝试从 LyricContent 属性提取
  const attrMatch = text.match(/LyricContent="([^"]*)"/);
  if (attrMatch) return attrMatch[1];
  // 尝试从 CDATA 段提取
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) return cdataMatch[1];
  return text;
};

/**
 * 通用逐字歌词解析
 * @param text 纯文本歌词内容
 * @param wordRe 逐字正则，需包含 3 个捕获组（顺序由 wordParser 决定）
 * @param wordParser 从正则匹配结果中提取 word/startTime/endTime
 */
const parseTimeline = (
  text: string,
  wordRe: RegExp,
  wordParser: (match: RegExpExecArray) => LyricWord,
): LyricLine[] => {
  const lines: LyricLine[] = [];

  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // 匹配行头时间戳
    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;

    const lineStart = parseInt(header[1]);
    const lineDur = parseInt(header[2]);
    const rest = trimmed.slice(header[0].length);

    // 解析逐字时间戳
    wordRe.lastIndex = 0;
    const words: LyricWord[] = [];
    let match: RegExpExecArray | null;
    while ((match = wordRe.exec(rest)) !== null) {
      words.push(wordParser(match));
    }

    if (words.length === 0) continue;

    lines.push({
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: lineStart,
      endTime: lineStart + lineDur,
      isBG: false,
      isDuet: false,
    });
  }

  return lines;
};

/**
 * 解析 QRC（QQ 音乐）歌词
 * 格式：[0,3000]Counting(0,500) Stars(500,500)
 * 支持 XML 包裹（LyricContent 属性或 CDATA 段）
 * @param text QRC 文本内容
 */
export const parseQRC = (text: string): LyricLine[] => {
  const content = extractFromXml(text);
  return parseTimeline(content, QRC_WORD_RE, (m) => {
    const start = parseInt(m[2]);
    const dur = parseInt(m[3]);
    return { word: m[1], startTime: start, endTime: start + dur };
  });
};

/**
 * 解析 YRC (Netease) 歌词
 * 格式：[0,3000](0,500,0)Counting(500,500,0) Stars
 * @param text YRC 文本内容
 */
export const parseYRC = (text: string): LyricLine[] =>
  parseTimeline(text, YRC_WORD_RE, (m) => {
    const start = parseInt(m[1]);
    const dur = parseInt(m[2]);
    return { word: m[3], startTime: start, endTime: start + dur };
  });
