/**
 * ASS（Advanced SubStation Alpha）字幕格式解析器
 *
 * 支持特性：
 * - 卡拉OK 逐字标签 {\kf<厘秒>} / {\k<厘秒>} / {\K<厘秒>}
 * - 多 Style 配对：orig（原词）、ts（翻译）、roma（音译）
 * - 同时间范围不同 Style 的行自动合并
 *
 * 时间格式：H:MM:SS.cc（厘秒，即 1/100 秒）
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { splitTrailingBackground, extractParentheticalBackground } from "./bg";

/** 匹配 Dialogue 行各字段 */
const DIALOGUE_RE = /^Dialogue:\s*\d+,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),([^,]*),/;

/** 匹配卡拉OK 标签 {\kf<n>} / {\k<n>} / {\K<n>} */
const KARAOKE_RE = /\{\\[kK]f?(\d+)\}([^{]*)/g;

/** 匹配所有 ASS 标签 {\xxx} */
const ASS_TAG_RE = /\{[^}]*\}/g;

/**
 * 解析 ASS 时间戳为毫秒
 * 格式：H:MM:SS.cc（厘秒）
 * @param value 时间戳字符串
 */
const parseAssTime = (value: string): number => {
  const parts = value.split(":");
  if (parts.length < 3) return 0;
  const hr = parseInt(parts[0]);
  const min = parseInt(parts[1]);
  const secParts = parts[2].split(".");
  const sec = parseInt(secParts[0]);
  const cs = parseInt(secParts[1] ?? "0");
  return ((hr * 60 + min) * 60 + sec) * 1000 + cs * 10;
};

/**
 * 从文本中解析卡拉OK 逐字标签为单词数组
 * @param text Dialogue 的 Text 字段（含 {\kf} 标签）
 * @param lineStart 行起始时间（毫秒）
 */
const parseKaraokeWords = (text: string, lineStart: number): LyricWord[] | null => {
  KARAOKE_RE.lastIndex = 0;
  const words: LyricWord[] = [];
  let cursor = lineStart;
  let match: RegExpExecArray | null;

  while ((match = KARAOKE_RE.exec(text)) !== null) {
    // {\kf<n>} 中 n 是厘秒（1/100秒）
    const durationCs = parseInt(match[1]);
    const word = match[2];
    if (!word && durationCs === 0) continue;

    const startTime = cursor;
    const endTime = cursor + durationCs * 10;
    if (word) {
      words.push({ startTime, endTime, word });
    }
    cursor = endTime;
  }

  return words.length > 0 ? words : null;
};

/**
 * 去除 ASS 标签，返回纯文本
 * @param text 含 ASS 标签的文本
 */
const stripAssTags = (text: string): string => text.replace(ASS_TAG_RE, "");

/** 已解析的 Dialogue 行 */
interface DialogueLine {
  startTime: number;
  endTime: number;
  style: string;
  text: string;
}

/**
 * 解析 ASS 字幕文本
 *
 * 按 Style 分类处理：
 * - orig：主歌词，解析 {\kf} 卡拉OK 标签为逐字时间
 * - ts：翻译，提取纯文本
 * - roma：音译，提取纯文本
 *
 * 同时间范围的不同 Style 行自动合并为一个 LyricLine
 * @param text ASS 文本内容
 * @returns 解析后的歌词行数组
 */
export const parseASS = (text: string): LyricLine[] => {
  // 解析所有 Dialogue 行
  const dialogues: DialogueLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    const match = DIALOGUE_RE.exec(trimmed);
    if (!match) continue;
    // 提取 Text 字段（最后一个逗号后的所有内容）
    const parts = trimmed.split(",");
    // Dialogue 格式有 10 个字段，Text 是最后一个（可能含逗号）
    const dialogueText = parts.slice(9).join(",");
    dialogues.push({
      startTime: parseAssTime(match[1]),
      endTime: parseAssTime(match[2]),
      style: match[3].trim().toLowerCase(),
      text: dialogueText,
    });
  }

  // 按时间范围分组，同时间的不同 Style 行归为一组
  const groups = new Map<string, { orig?: DialogueLine; ts?: DialogueLine; roma?: DialogueLine }>();
  for (const d of dialogues) {
    const key = `${d.startTime}-${d.endTime}`;
    const group = groups.get(key) ?? {};
    if (d.style === "orig" || d.style === "default") {
      group.orig = d;
    } else if (d.style === "ts" || d.style === "translate" || d.style === "translation") {
      group.ts = d;
    } else if (d.style === "roma" || d.style === "roman" || d.style === "romaji") {
      group.roma = d;
    } else if (!group.orig) {
      // 未知 Style 且没有 orig 时作为原词
      group.orig = d;
    }
    groups.set(key, group);
  }

  // 构建歌词行
  const lines: LyricLine[] = [];
  for (const group of groups.values()) {
    const source = group.orig;
    if (!source) continue;

    // 尝试解析卡拉OK 逐字标签
    let karaokeWords = parseKaraokeWords(source.text, source.startTime);
    let words: LyricWord[] = karaokeWords ?? [
      { startTime: source.startTime, endTime: source.endTime, word: stripAssTags(source.text) },
    ];

    // 检测行内括号背景
    extractParentheticalBackground(words);

    // 添加背景行（如果有）
    const bg = extractParentheticalBackground(words).bg;
    if (bg) {
      lines.push(bg);
    }

    const translatedLyric = group.ts ? stripAssTags(group.ts.text).trim() : "";
    const romanLyric = group.roma ? stripAssTags(group.roma.text).trim() : "";

    lines.push({
      words,
      translatedLyric,
      romanLyric,
      startTime: source.startTime,
      endTime: source.endTime,
      isBG: false,
      isDuet: false,
    });
  }

  // 按时间排序
  lines.sort((a, b) => a.startTime - b.startTime);

  // 后处理：处理行尾括号背景（主歌词（和声））
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.isBG) continue;

    const trailingBg = splitTrailingBackground(line, true);
    if (trailingBg) {
      lines.splice(i + 1, 0, trailingBg);
      i++;
    }
  }

  return lines;
};
