/**
 * LyS（Lyricify Syllable）歌词解析器
 *
 * 格式：[属性码]文字(起始ms,时长ms)文字(起始ms,时长ms)
 *
 * 属性码编码背景行和对唱标记：
 * - 0/1: 普通行
 * - 2/5: 对唱行（isDuet）
 * - 6/7: 背景行（isBG）
 * - 8: 背景 + 对唱
 *
 * 逐字格式与 QRC 相同（文字在前，时间在后），但行头是属性码而非时间戳
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";

/** 匹配行头属性码 [0]~[9] */
const PROP_RE = /^\[(\d)\]/;

/** 匹配逐字时间戳：文字(起始ms,时长ms) */
const WORD_RE = /([^(]+)\((\d+),(\d+)\)/g;

/**
 * 解析 LyS 逐字
 * 格式：文字(起始ms,时长ms)文字(起始ms,时长ms)
 * @param content 去掉行首属性码后的内容
 * @returns 解析出的单词数组，非逐字格式返回 null
 */
const parseLySWords = (content: string): LyricWord[] | null => {
  const words: LyricWord[] = [];
  let match: RegExpExecArray | null;

  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(content)) !== null) {
    const wordStart = parseInt(match[2]);
    const wordDur = parseInt(match[3]);
    words.push({
      word: match[1],
      startTime: wordStart,
      endTime: wordStart + wordDur,
    });
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

/**
 * 解析属性码为 isBG 和 isDuet
 * @param code 属性码（0~8）
 */
const parseProperty = (code: number): { isBG: boolean; isDuet: boolean } => {
  switch (code) {
    case 2:
    case 5:
      return { isBG: false, isDuet: true };
    case 6:
    case 7:
      return { isBG: true, isDuet: false };
    case 8:
      return { isBG: true, isDuet: true };
    default:
      return { isBG: false, isDuet: false };
  }
};

/**
 * 解析 LyS 歌词文本
 * @param text LyS 文本内容
 * @returns 解析后的歌词行数组
 */
export const parseLyS = (text: string): LyricLine[] => {
  const lines: LyricLine[] = [];

  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // 匹配行头属性码
    const propMatch = PROP_RE.exec(trimmed);
    if (!propMatch) continue;

    const { isBG, isDuet } = parseProperty(parseInt(propMatch[1]));
    const rest = trimmed.slice(propMatch[0].length);

    // 在逐字解析之前，从原始 rest 提取最后一个时间戳后的括号内容作为背景
    let lastTimingEnd = -1;
    let timingMatch: RegExpExecArray | null;
    const timingReLys = /\(\d+,\d+\)/g;
    while ((timingMatch = timingReLys.exec(rest)) !== null) {
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

    // 解析逐字时间戳
    const words = parseLySWords(rest);

    if (!words) continue;

    lines.push({
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: words[0].startTime,
      endTime: words[words.length - 1].endTime,
      isBG,
      isDuet,
    });

    // 如果有提取到的背景词，添加为背景行
    if (backgroundWord) {
      const bgWords: LyricWord[] = [
        {
          word: backgroundWord,
          startTime: words[0].startTime,
          endTime: words[words.length - 1].endTime,
        },
      ];
      lines.push({
        words: bgWords,
        translatedLyric: "",
        romanLyric: "",
        startTime: words[0].startTime,
        endTime: words[words.length - 1].endTime,
        isBG: true,
        isDuet: false,
      });
    }
  }

  return lines;
};
