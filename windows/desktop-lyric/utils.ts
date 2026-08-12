import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign, DesktopLyricSettings } from "@shared/types/settings";

/** 待渲染行的数据载体 */
export interface DisplayItem {
  key: string;
  index: number;
  line: LyricLine;
  align: DesktopLyricAlign;
  scrollEnabled?: boolean;
  isPlaceholder?: boolean;
  isNext?: boolean;
}

/** 超长文本的横向滚动范围 */
export interface HorizontalScrollRange {
  /** 将文本开头对齐容器左侧所需的平移量 */
  startOffset: number;
  /** 从文本开头滚动到末尾的距离 */
  distance: number;
}

/**
 * 计算超长文本在不同对齐方式下的滚动范围
 * @param containerWidth - 可见容器宽度
 * @param contentWidth - 完整内容宽度
 * @param contentLeft - 内容未平移时相对容器的左偏移
 * @returns 滚动起点与距离
 */
export const computeHorizontalScrollRange = (
  containerWidth: number,
  contentWidth: number,
  contentLeft: number,
): HorizontalScrollRange => {
  const distance = contentWidth - containerWidth;
  if (distance <= 0.5) return { startOffset: 0, distance: 0 };
  return { startOffset: contentLeft === 0 ? 0 : -contentLeft, distance };
};

/**
 * 从元素布局尺寸读取横向滚动范围，避免祖先 transform 缩放测量结果
 * @param container - 可见容器
 * @param content - 完整内容元素
 * @returns 滚动起点与距离
 */
export const measureHorizontalScrollRange = (
  container: Pick<HTMLElement, "clientWidth">,
  content: Pick<HTMLElement, "scrollWidth" | "offsetLeft">,
): HorizontalScrollRange =>
  computeHorizontalScrollRange(container.clientWidth, content.scrollWidth, content.offsetLeft);

/** 横向滚动开始前的停留比例 */
const HORIZONTAL_SCROLL_START_RATIO = 0.3;
/** 长歌词滚动结束后保留的最大停留时间 */
const HORIZONTAL_SCROLL_END_MARGIN_MS = 2000;
/** 短歌词滚动结束后保留的时长比例 */
const HORIZONTAL_SCROLL_END_MARGIN_RATIO = 0.2;
/** 短歌词也能展示连续滚动过程的最小时长 */
const MIN_HORIZONTAL_SCROLL_DURATION_MS = 1200;

export interface HorizontalScrollOffsetOptions {
  currentMs: number;
  activatedAtMs: number;
  lineStartTime: number;
  lineEndTime: number;
  startOffset: number;
  distance: number;
}

/**
 * 计算当前帧的横向滚动偏移
 * @param options - 歌词时间轴与滚动范围
 * @returns 当前横向偏移像素
 */
export const computeHorizontalScrollOffset = (options: HorizontalScrollOffsetOptions): number => {
  const { currentMs, activatedAtMs, lineStartTime, lineEndTime, startOffset, distance } = options;
  if (distance <= 0) return startOffset;

  const scrollStartTime = Math.max(lineStartTime, activatedAtMs);
  const naturalDuration = Math.max(0, lineEndTime - scrollStartTime);
  const duration = Math.max(MIN_HORIZONTAL_SCROLL_DURATION_MS, naturalDuration);
  const endMargin = Math.min(
    HORIZONTAL_SCROLL_END_MARGIN_MS,
    duration * HORIZONTAL_SCROLL_END_MARGIN_RATIO,
  );
  const motionDuration = Math.max(1, duration - endMargin);
  const progress = Math.max(0, Math.min(1, (currentMs - scrollStartTime) / motionDuration));
  if (progress <= HORIZONTAL_SCROLL_START_RATIO) return startOffset;

  const ratio = (progress - HORIZONTAL_SCROLL_START_RATIO) / (1 - HORIZONTAL_SCROLL_START_RATIO);
  return startOffset - distance * ratio;
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
  return `${Math.round(fontSize * 1.6)}px`;
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
export const resolveAlign = (index: number, baseAlign: DesktopLyricAlign): DesktopLyricAlign => {
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
