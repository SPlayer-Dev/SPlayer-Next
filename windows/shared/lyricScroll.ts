import type { LyricLine } from "lyric-kit";

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
/** 演唱位置越过容器中的这一比例后文本开始左移 */
const FOLLOW_FOCUS_RATIO = 0.5;

export interface HorizontalScrollOffsetOptions {
  currentMs: number;
  activatedAtMs: number;
  lineStartTime: number;
  lineEndTime: number;
  startOffset: number;
  distance: number;
}

/**
 * 按行时长匀速计算当前帧的横向滚动偏移，用于没有逐字时间的歌词
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
 * @param line - 歌词行
 * @returns 是否可按逐字时间定位演唱位置
 */
export const hasRealWordTiming = (line: LyricLine): boolean => {
  if (line.words.length <= 1) return false;
  const first = line.words[0];
  return first.endTime > first.startTime;
};

/**
 * 计算演唱位置在整行文本中的比例
 * 以各词开始时刻为关键帧按字数插值，词间空隙也连续移动，避免镜头走走停停
 * @param line - 带逐字时间的歌词行
 * @param currentMs - 当前播放时间
 * @returns 0 到 1 的演唱进度
 */
export const computeSingingProgress = (line: LyricLine, currentMs: number): number => {
  const { words } = line;
  const totalChars = words.reduce((sum, word) => sum + word.word.length, 0);
  if (totalChars === 0) return 0;
  let passedChars = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const nextStart = index + 1 < words.length ? words[index + 1].startTime : word.endTime;
    if (currentMs < nextStart) {
      const span = nextStart - word.startTime;
      const within = span > 0 ? Math.max(0, Math.min(1, (currentMs - word.startTime) / span)) : 1;
      return (passedChars + within * word.word.length) / totalChars;
    }
    passedChars += word.word.length;
  }
  return 1;
};

export interface LyricScrollOffsetOptions {
  currentMs: number;
  activatedAtMs: number;
  /** 决定滚动进度的歌词行，翻译行传对应的原文行 */
  timingLine: LyricLine;
  containerWidth: number;
  range: HorizontalScrollRange;
}

/**
 * 计算歌词行当前帧的横向滚动偏移
 * 有逐字时间时让演唱位置停在容器焦点处，否则按行时长匀速滚动
 * @param options - 时间轴、容器宽度与滚动范围
 * @returns 当前横向偏移像素
 */
export const computeLyricScrollOffset = (options: LyricScrollOffsetOptions): number => {
  const { currentMs, activatedAtMs, timingLine, containerWidth, range } = options;
  if (range.distance <= 0) return range.startOffset;
  if (!hasRealWordTiming(timingLine)) {
    return computeHorizontalScrollOffset({
      currentMs,
      activatedAtMs,
      lineStartTime: timingLine.startTime,
      lineEndTime: timingLine.endTime,
      startOffset: range.startOffset,
      distance: range.distance,
    });
  }
  const singingX =
    computeSingingProgress(timingLine, currentMs) * (containerWidth + range.distance);
  const travel = Math.max(
    0,
    Math.min(range.distance, singingX - containerWidth * FOLLOW_FOCUS_RATIO),
  );
  return range.startOffset - travel;
};
