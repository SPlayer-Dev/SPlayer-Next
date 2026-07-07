import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { BRACKET_TIME_RE, ANGLE_TIME_RE, parseTime, MAX_TIME } from "./timestamp";
import { detectBackgroundLine } from "./bg";

/** 匹配元数据标签（如 [ti:xxx]、[ar:xxx]） */
const META_TAG_RE = /^\[[a-zA-Z]+:/;

/** 检测尖括号逐字标签 */
const HAS_ANGLE_TAGS = /<\d+:\d+/;

/**
 * 判断一行原始文本是否应跳过（非歌词内容）
 * @param line trim 后的行文本
 */
const shouldSkipLine = (line: string): boolean => {
  if (!line) return true;
  // 元数据标签：[ti:xxx]、[ar:xxx] 等
  if (META_TAG_RE.test(line)) return true;
  // JSON 行（平台的扩展元数据）
  if (line.startsWith("{")) return true;
  return false;
};

/**
 * 提取行首连续的方括号时间戳
 * @param line 原始行文本
 * @returns 时间戳数组和文本起始位置
 */
const extractHeaderTimes = (line: string): { times: number[]; textStart: number } => {
  BRACKET_TIME_RE.lastIndex = 0;
  const times: number[] = [];
  let textStart = 0;
  let match: RegExpExecArray | null;
  while ((match = BRACKET_TIME_RE.exec(line)) !== null) {
    if (match.index !== textStart) break;
    times.push(parseTime(match[1], match[2], match[3]));
    textStart = BRACKET_TIME_RE.lastIndex;
  }
  return { times, textStart };
};

/**
 * 尝试解析 ESLRC 逐字
 * 格式：<00:00.000>一<00:00.186>句<00:00.373>话
 * @param content 去掉行首时间戳后的内容
 * @returns 解析出的单词数组，非 ESLRC 格式返回 null
 */
const parseEslrcWords = (content: string): LyricWord[] | null => {
  if (!HAS_ANGLE_TAGS.test(content)) return null;
  // 尝试 ESLRC 逐字
  ANGLE_TIME_RE.lastIndex = 0;
  const words: LyricWord[] = [];
  let match: RegExpExecArray | null;
  while ((match = ANGLE_TIME_RE.exec(content)) !== null) {
    const wordText = match[4];
    if (!wordText) continue;
    words.push({
      startTime: parseTime(match[1], match[2], match[3] ?? "0"),
      endTime: 0,
      word: wordText,
    });
  }
  if (words.length === 0) return null;
  // 每个单词的结束时间 = 下一个单词的开始时间
  for (let i = 0; i < words.length - 1; i++) {
    words[i].endTime = words[i + 1].startTime;
  }
  return words;
};

/**
 * 解析 LRC 逐字
 * 格式：[00:00.000]一[00:00.186]句[00:00.373]话
 * @param line 完整的一行文本
 * @returns 解析出的单词数组，非逐字格式返回 null
 */
const parseLrcWords = (line: string): LyricWord[] | null => {
  BRACKET_TIME_RE.lastIndex = 0;
  const words: LyricWord[] = [];
  let prevTime = -1;
  let prevTextStart = -1;
  let tagCount = 0;
  // 逐个扫描时间戳，两个时间戳之间的文本为一个单词
  let match: RegExpExecArray | null;
  while ((match = BRACKET_TIME_RE.exec(line)) !== null) {
    const time = parseTime(match[1], match[2], match[3]);
    tagCount++;
    // 上一个时间戳到当前时间戳之间的文本
    if (prevTime >= 0 && prevTextStart >= 0) {
      const word = line.slice(prevTextStart, match.index);
      if (word) {
        words.push({ startTime: prevTime, endTime: time, word });
      }
    }
    prevTime = time;
    prevTextStart = BRACKET_TIME_RE.lastIndex;
  }
  // 至少要有 2 个时间戳且有文字才算逐字格式
  if (tagCount < 2 || words.length === 0) return null;
  // 最后一个时间戳后的剩余文本
  if (prevTextStart < line.length) {
    const word = line.slice(prevTextStart);
    if (word) {
      words.push({ startTime: prevTime, endTime: 0, word });
    }
  }
  return words;
};

/**
 * 解析 LRC 歌词文本
 * @param text LRC 文本内容
 * @returns 解析后的歌词行数组，按时间排序
 */
export const parseLRC = (text: string, detectBackground = true): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (shouldSkipLine(trimmed)) continue;
    // 提取行首连续时间戳
    const { times, textStart } = extractHeaderTimes(trimmed);
    if (times.length === 0) continue;
    // 提取行内容
    const content = trimmed.slice(textStart);
    if (!content.trim()) continue;
    // 尝试 ESLRC 逐字
    const eslrcWords = parseEslrcWords(content);
    if (eslrcWords) {
      for (const _ of times) {
        // 多时间戳时克隆单词数组
        const words = times.length > 1 ? eslrcWords.map((w) => ({ ...w })) : eslrcWords;
        lines.push({
          words,
          translatedLyric: "",
          romanLyric: "",
          startTime: words[0].startTime,
          endTime: words[words.length - 1].endTime,
          isBG: detectBackgroundLine(words, detectBackground),
          isDuet: false,
        });
      }
      continue;
    }
    // 尝试 LRC 逐字
    const lrcWords = parseLrcWords(trimmed);
    if (lrcWords) {
      lines.push({
        words: lrcWords,
        translatedLyric: "",
        romanLyric: "",
        startTime: lrcWords[0].startTime,
        endTime: lrcWords[lrcWords.length - 1].endTime,
        isBG: detectBackgroundLine(lrcWords, detectBackground),
        isDuet: false,
      });
      continue;
    }
    // 回退标准整行模式
    const lineWords = [{ startTime: 0, endTime: 0, word: content.trim() }];
    const isBG = detectBackgroundLine(lineWords, detectBackground);
    for (const t of times) {
      lines.push({
        words: [{ startTime: t, endTime: 0, word: lineWords[0].word }],
        translatedLyric: "",
        romanLyric: "",
        startTime: t,
        endTime: 0,
        isBG,
        isDuet: false,
      });
    }
  }
  // 按起始时间排序
  lines.sort((a, b) => a.startTime - b.startTime);
  // 合并同 startTime 的隔行翻译：第一行为主；第二行为 translation；第三行为 romaji；再多忽略
  const merged: LyricLine[] = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev && prev.startTime === line.startTime) {
      const text = line.words
        .map((w) => w.word)
        .join("")
        .trim();
      if (!text) continue;
      if (!prev.translatedLyric) prev.translatedLyric = text;
      else if (!prev.romanLyric) prev.romanLyric = text;
      continue;
    }
    merged.push(line);
  }

  // 反向遍历填充 endTime
  let lastStartTime = MAX_TIME;
  for (let i = merged.length - 1; i >= 0; i--) {
    const line = merged[i];
    // 行级 endTime = 下一行的 startTime
    if (line.endTime <= line.startTime) {
      line.endTime = lastStartTime;
    }
    // 最后一个单词的 endTime 跟随行
    const lastWord = line.words[line.words.length - 1];
    if (lastWord && lastWord.endTime <= lastWord.startTime) {
      lastWord.endTime = line.endTime;
    }
    // 整行模式下唯一单词的 endTime 跟随行
    if (line.words.length === 1 && line.words[0].endTime <= line.words[0].startTime) {
      line.words[0].endTime = line.endTime;
    }
    lastStartTime = line.startTime;
  }
  return merged;
};
