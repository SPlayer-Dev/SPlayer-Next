import type { ExternalLyric, LyricFormat, LyricLine } from "@/types/lyric";
import { parseLRC } from "./parseLRC";
import { parseQRC, parseYRC } from "./parseTimeline";
import { parseTTML } from "./parseTTML";
import { parseLyS } from "./parseLyS";
import { parseSRT } from "./parseSRT";
import { parseASS } from "./parseASS";

/** 格式优先级（越靠前越优先） */
const FORMAT_PRIORITY: LyricFormat[] = ["ttml", "lys", "qrc", "yrc", "lrc", "ass", "srt"];

/**
 * 从外部歌词列表中选出最优格式的索引
 * @param lyrics 外部歌词列表
 * @returns 最优格式的索引，无可用歌词时返回 -1
 */
export const bestExternalIndex = (lyrics: ExternalLyric[]): number => {
  if (lyrics.length === 0) return -1;
  let bestIdx = 0;
  let bestPriority = FORMAT_PRIORITY.length;
  for (let i = 0; i < lyrics.length; i++) {
    const p = FORMAT_PRIORITY.indexOf(lyrics[i].format);
    const priority = p === -1 ? FORMAT_PRIORITY.length : p;
    if (priority < bestPriority) {
      bestPriority = priority;
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
export const parseLyric = (text: string, format: LyricFormat): LyricLine[] => {
  switch (format) {
    case "ttml":
      return parseTTML(text);
    case "qrc":
      return parseQRC(text);
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
    const text = transLine.words.map((w) => w.word).join("").trim();
    if (!text) continue;
    // 在主歌词中找 startTime 最接近的非空行
    let nearest: LyricLine | undefined;
    let minDiff = Infinity;
    for (const mainLine of lines) {
      if (mainLine.words.map((w) => w.word).join("").trim().length === 0) continue;

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

/**
 * 根据播放时间查找当前歌词行索引（二分查找）
 * @param lines 已按 startTime 排序的歌词行数组
 * @param time 当前播放时间（毫秒）
 * @param prevIndex 上一次的索引，用于快速路径优化
 * @returns 匹配的行索引，无匹配返回 -1
 */
export const findLyricIndex = (lines: LyricLine[], time: number, prevIndex = -1): number => {
  if (lines.length === 0) return -1;

  // 快速路径：当前索引仍然有效
  if (prevIndex >= 0 && prevIndex < lines.length) {
    const current = lines[prevIndex];
    if (time >= current.startTime && time < current.endTime) return prevIndex;
    // 检查下一行（正常播放最常见的情况）
    const next = lines[prevIndex + 1];
    if (next && time >= next.startTime && time < next.endTime) return prevIndex + 1;
  }

  // 二分查找：找最后一个 startTime <= time 的行
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].startTime <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // 在该行时间范围内，或处于该行 endTime 与下一行 startTime 之间的间隙，都停留在该行
  if (result >= 0) {
    if (time < lines[result].endTime) return result;
    const next = lines[result + 1];
    if (!next || time < next.startTime) return result;
  }

  // 跳过背景歌词行，往前找最近的主歌词行
  while (result >= 0 && lines[result].isBG) result--;

  return result;
};
