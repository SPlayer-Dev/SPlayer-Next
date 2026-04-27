import type { LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@shared/types/lyrics";
import { parseLRC } from "./parseLRC";
import { parseQRC } from "./parseQRC";
import { parseYRC } from "./parseYRC";
import { parseKRC } from "./parseKRC";
import { parseTTML } from "./parseTTML";
import { parseLyS } from "./parseLyS";
import { parseSRT } from "./parseSRT";
import { parseASS } from "./parseASS";

/**
 * 从外部歌词列表中选出最优格式的索引
 * @param lyrics   外部歌词列表
 * @param priority 自定义格式优先级
 * @returns 最优格式的索引，无可用歌词时返回 -1
 */
export const bestExternalIndex = (
  lyrics: { format: LyricFormat }[],
  priority?: readonly LyricFormat[],
): number => {
  if (lyrics.length === 0) return -1;
  const order = priority && priority.length > 0 ? priority : DEFAULT_LYRIC_FORMAT_ORDER;
  let bestIdx = 0;
  let bestPriority = order.length;
  for (let i = 0; i < lyrics.length; i++) {
    const p = order.indexOf(lyrics[i].format);
    const rank = p === -1 ? order.length : p;
    if (rank < bestPriority) {
      bestPriority = rank;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/**
 * 根据内容特征检测歌词格式
 * 用于内嵌歌词等无扩展名的场景
 * @param text 歌词文本内容
 * @returns 检测到的格式，默认 "lrc"
 */
export const detectFormat = (text: string): LyricFormat => {
  const trimmed = text.trimStart();
  // ASS
  if (trimmed.startsWith("[Script Info]") || /^\[V4\+? Styles\]/m.test(text)) return "ass";
  // SRT：序号 + 时间行
  if (/^\d+\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(trimmed)) return "srt";
  // TTML / QRC XML
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    if (/LyricContent="|<QrcInfos|<Lyric_/.test(text)) return "qrc";
    if (trimmed.startsWith("<tt") || /<tt\s/i.test(text)) return "ttml";
  }
  // YRC：[起始,时长](起始,时长,0)
  if (/\[\d+,\d+\]\(\d+,\d+,\d+\)/.test(text)) return "yrc";
  // QRC 纯文本：[起始,时长]文字(起始,时长)
  if (/\[\d+,\d+\][^[\n]+\(\d+,\d+\)/.test(text)) return "qrc";
  // LyS：[属性码]文字(起始,时长)
  if (/^\[\d\][^[\]]+\(\d+,\d+\)/m.test(text)) return "lys";
  // 兜底 LRC
  return "lrc";
};

/**
 * 根据格式类型解析歌词文本
 * @param text 歌词文本内容
 * @param format 歌词格式
 * @returns 解析后的歌词行数组
 */
const parseContent = (text: string, format: LyricFormat): LyricLine[] => {
  switch (format) {
    case "ttml":
      return parseTTML(text);
    case "qrc":
      return parseQRC(text);
    case "krc":
      return parseKRC(text);
    case "yrc":
      return parseYRC(text);
    case "lrc":
      return parseLRC(text);
    case "lys":
      return parseLyS(text);
    case "srt":
      return parseSRT(text);
    case "ass":
      return parseASS(text);
  }
};

/**
 * 解析歌词
 * @param input 主 + 可选翻译 / 音译
 * @param format 主歌词格式
 */
export const parseLyric = (input: LyricInput, format: LyricFormat): LyricLine[] => {
  const lines = parseContent(input.content, format);
  if (input.translation && input.translationFormat) {
    pairTranslation(
      lines,
      parseContent(input.translation, input.translationFormat),
      "translatedLyric",
    );
  }
  if (input.romaji && input.romajiFormat) {
    pairTranslation(lines, parseContent(input.romaji, input.romajiFormat), "romanLyric");
  }
  return lines;
};

/**
 * 将翻译/音译歌词按时间戳对齐到主歌词行
 * @param lines 主歌词行数组（会被原地修改）
 * @param transLines 已解析的翻译/音译歌词行
 * @param field 写入目标字段："translatedLyric" 或 "romanLyric"
 */
export const pairTranslation = (
  lines: LyricLine[],
  transLines: LyricLine[],
  field: "translatedLyric" | "romanLyric",
): void => {
  for (const transLine of transLines) {
    // 跳过空行
    const text = transLine.words
      .map((w) => w.word)
      .join("")
      .trim();
    if (!text) continue;
    // 在主歌词中找 startTime 最接近的非空行
    let nearest: LyricLine | undefined;
    let minDiff = Infinity;
    for (const mainLine of lines) {
      if (
        mainLine.words
          .map((w) => w.word)
          .join("")
          .trim().length === 0
      )
        continue;

      const diff = Math.abs(mainLine.startTime - transLine.startTime);
      // 精确匹配直接命中
      if (diff === 0) {
        nearest = mainLine;
        break;
      }
      if (diff < minDiff) {
        minDiff = diff;
        nearest = mainLine;
      }
    }
    if (nearest) {
      if (nearest[field].length > 0) {
        nearest[field] += text;
      } else {
        nearest[field] = text;
      }
    }
  }
};
