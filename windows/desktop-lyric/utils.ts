import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign, DesktopLyricSettings } from "@shared/types/settings";

/** 待渲染行的数据载体 */
export interface DisplayItem {
  key: string;
  index: number;
  line: LyricLine;
  align: DesktopLyricAlign;
  isPlaceholder?: boolean;
  isNext?: boolean;
}

/**
 * 选出当前应作为 primary 的行索引
 * @param lines 歌词行数组
 * @param time 当前播放毫秒
 */
export const pickPrimaryIndex = (lines: LyricLine[], time: number): number => {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let latest = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].startTime <= time) {
      latest = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (latest < 0) return -1;
  const latestActive = time < lines[latest].endTime;
  if (!latestActive) return latest;
  if (latest > 0) {
    const prev = lines[latest - 1];
    if (prev.startTime <= time && time < prev.endTime) return latest - 1;
  }
  return latest;
};

/**
 * 是否带真实逐字时间
 * @param line 歌词行
 */
export const hasRealWordTiming = (line: LyricLine): boolean => {
  if (line.words.length <= 1) return false;
  const first = line.words[0];
  return first.endTime > first.startTime;
};

/**
 * 构造占位歌词行
 * @param text 占位文本
 */
export const makePlaceholderLine = (text: string): LyricLine => ({
  words: [{ word: text, startTime: 0, endTime: 0 }],
  translatedLyric: "",
  romanLyric: "",
  startTime: 0,
  endTime: 0,
  isBG: false,
  isDuet: false,
});

/**
 * 行索引对应的 absolute top
 * @param index 行索引
 * @param fontSize 主字号 px
 */
export const getLineTop = (index: number, fontSize: number): string => {
  if (index === 0) return "0px";
  return `${Math.round(fontSize * 1.9)}px`;
};

/** 字号下限（与设置 schema 一致） */
const MIN_FONT_SIZE = 20;
/** 字号上限（与设置 schema 一致） */
const MAX_FONT_SIZE = 96;
/** 对应最小字号的窗口高度 */
const MIN_WINDOW_HEIGHT = 140;
/** 对应最大字号的窗口高度 */
const MAX_WINDOW_HEIGHT = 360;

/**
 * 字号线性映射到窗口总高度
 * 与 CSS 解耦：不依赖 line-height / padding 等可变因素，留足视觉余量
 * @param fontSize 主字号 px
 */
export const computeWindowHeight = (fontSize: number): number => {
  const clamped = Math.min(Math.max(Math.round(fontSize), MIN_FONT_SIZE), MAX_FONT_SIZE);
  const ratio = (clamped - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE);
  return Math.round(MIN_WINDOW_HEIGHT + ratio * (MAX_WINDOW_HEIGHT - MIN_WINDOW_HEIGHT));
};

/**
 * 解析行对齐方式，justify 时按 index 奇偶切左右
 * @param index 行索引
 * @param baseAlign 配置的基础对齐
 */
export const resolveAlign = (
  index: number,
  baseAlign: DesktopLyricAlign,
): DesktopLyricAlign => {
  if (baseAlign !== "justify") return baseAlign;
  return index % 2 === 0 ? "left" : "right";
};

/**
 * 判定是否逐字渲染
 * @param config 逐字相关配置
 * @param item 待渲染项
 */
export const resolveWordByWord = (
  config: Pick<DesktopLyricSettings, "wordByWord" | "autoGenerateWordByWord">,
  item: DisplayItem,
): boolean => {
  if (!config.wordByWord) return false;
  if (item.isPlaceholder) return false;
  if (config.autoGenerateWordByWord) return true;
  return hasRealWordTiming(item.line);
};

const LAST_LINE_FALLBACK_MS = 8000;

/**
 * 将最后一行无效 endTime 截到曲目时长或 startTime+8s
 * @param lines 歌词行数组
 * @param trackDurationMs 曲目时长 ms
 */
export const clampLastLineEnd = (
  lines: LyricLine[],
  trackDurationMs?: number,
): LyricLine[] => {
  if (lines.length === 0) return lines;
  const last = lines[lines.length - 1];
  const reasonable =
    typeof trackDurationMs === "number" && trackDurationMs > last.startTime
      ? trackDurationMs
      : last.startTime + LAST_LINE_FALLBACK_MS;
  if (last.endTime <= reasonable) return lines;
  const clamped: LyricLine = {
    ...last,
    endTime: reasonable,
    words: last.words.map((w, i, arr) =>
      i === arr.length - 1 && w.endTime > reasonable ? { ...w, endTime: reasonable } : w,
    ),
  };
  return [...lines.slice(0, -1), clamped];
};
