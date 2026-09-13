/**
 * 歌词序列化
 *
 * 把解析后的 LyricLine[] 重新序列化为标准歌词文本，用于下载保存 / 内嵌
 * 走 parse → 重序列化，[ti:]/[ar:] 等信息头天然被丢弃，内容只剩歌词
 */

import type { LyricInput, LyricFormat, LyricLine } from "@shared/types/lyrics";
import type { DownloadLyricFormat } from "@shared/types/download";
import { parseLyric } from "./parse";

const pad2 = (value: number): string => String(value).padStart(2, "0");
const pad3 = (value: number): string => String(value).padStart(3, "0");

/** 毫秒 → mm:ss.xx（厘秒，标准 LRC） */
const formatLrcTime = (ms: number): string => {
  const totalCs = Math.round(Math.max(0, ms) / 10);
  const cs = totalCs % 100;
  const totalSec = (totalCs - cs) / 100;
  const sec = totalSec % 60;
  const min = (totalSec - sec) / 60;
  return `${pad2(min)}:${pad2(sec)}.${pad2(cs)}`;
};

/** 毫秒 → mm:ss.mmm（TTML） */
const formatTtmlTime = (ms: number): string => {
  const total = Math.max(0, Math.round(ms));
  const msPart = total % 1000;
  const totalSec = (total - msPart) / 1000;
  const sec = totalSec % 60;
  const min = (totalSec - sec) / 60;
  return `${pad2(min)}:${pad2(sec)}.${pad3(msPart)}`;
};

/** 行主文本 */
const lineMainText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join("")
    .trim();

/** 逐行 LRC；双语时翻译行紧随主歌词、共用时间戳 */
const toLrc = (lines: LyricLine[]): string => {
  const out: string[] = [];
  for (const line of lines) {
    const text = lineMainText(line);
    if (!text) continue;
    const ts = `[${formatLrcTime(line.startTime)}]`;
    out.push(`${ts}${text}`);
    if (line.translatedLyric) out.push(`${ts}${line.translatedLyric}`);
  }
  return out.join("\n");
};

/** 逐字增强 LRC（A2 内联 <mm:ss.xx>）；翻译降级为整行 */
const toEnhancedLrc = (lines: LyricLine[]): string => {
  const out: string[] = [];
  for (const line of lines) {
    if (line.words.length === 0) continue;
    const lineTs = `[${formatLrcTime(line.startTime)}]`;
    const body = line.words
      .map((word) => `<${formatLrcTime(word.startTime)}>${word.word}`)
      .join("");
    if (!body.trim()) continue;
    out.push(`${lineTs}${body}`);
    if (line.translatedLyric) out.push(`${lineTs}${line.translatedLyric}`);
  }
  return out.join("\n");
};

/** XML 文本转义 */
const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 逐字 span 串 */
const wordSpans = (line: LyricLine): string =>
  line.words
    .map(
      (word) =>
        `<span begin="${formatTtmlTime(word.startTime)}" end="${formatTtmlTime(word.endTime)}">${escapeXml(word.word)}</span>`,
    )
    .join("");

/** 角色 span（翻译 / 音译），空则不输出 */
const roleSpan = (role: string, text: string): string =>
  text ? `<span ttm:role="${role}">${escapeXml(text)}</span>` : "";

/** 背景行嵌套 span */
const bgSpan = (bg: LyricLine): string =>
  `<span ttm:role="x-bg">${wordSpans(bg)}${roleSpan("x-translation", bg.translatedLyric)}${roleSpan("x-roman", bg.romanLyric)}</span>`;

/** 一行 <p>：主词 + 翻译 + 音译 + 背景行；对唱标 agent */
const paragraph = (main: LyricLine, bgs: LyricLine[]): string => {
  const agent = main.isDuet ? ' ttm:agent="v2"' : "";
  const inner =
    wordSpans(main) +
    roleSpan("x-translation", main.translatedLyric) +
    roleSpan("x-roman", main.romanLyric) +
    bgs.map(bgSpan).join("");
  return `<p begin="${formatTtmlTime(main.startTime)}" end="${formatTtmlTime(main.endTime)}"${agent}>${inner}</p>`;
};

/** 完整 TTML（原文 + 翻译 + 音译 + 背景 / 对唱），用行内 role，可被 parseTTML 读回 */
const toTtml = (lines: LyricLine[]): string => {
  // LyricLine[] 是扁平的，背景行紧随其主行；按此还原嵌套
  const groups: { main: LyricLine; bg: LyricLine[] }[] = [];
  for (const line of lines) {
    if (line.isBG && groups.length) groups[groups.length - 1].bg.push(line);
    else groups.push({ main: line, bg: [] });
  }
  const body = groups.map((group) => `      ${paragraph(group.main, group.bg)}`).join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll">',
    "  <body>",
    "    <div>",
    body,
    "    </div>",
    "  </body>",
    "</tt>",
  ].join("\n");
};

/**
 * 把下载到的歌词序列化为指定格式
 * - lrc / enhanced-lrc：丢弃信息头，双语写主 + 翻译
 * - ttml：源格式已是 ttml 则直接保留原文本（避免格式化丢失元数据与样式）；其它格式转换为标准 ttml
 * @param input - 主歌词 + 可选翻译 / 音译
 * @param mainFormat - 主歌词源格式
 * @param target - 目标格式
 * @returns 歌词文本；无有效内容返回 null
 */
export const buildDownloadLyric = (
  input: LyricInput,
  mainFormat: LyricFormat,
  target: DownloadLyricFormat | "ttml",
): string | null => {
  if (!input.content?.trim()) return null;
  let lines: LyricLine[];
  try {
    lines = parseLyric(input, mainFormat);
  } catch {
    return null;
  }
  if (lines.length === 0) return null;
  if (target === "ttml") {
    return mainFormat === "ttml" ? input.content.trim() : toTtml(lines);
  }
  const content = target === "enhanced-lrc" ? toEnhancedLrc(lines) : toLrc(lines);
  return content.trim() ? content : null;
};
