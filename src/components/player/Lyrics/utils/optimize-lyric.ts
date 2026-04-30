import type { LyricLine } from "@shared/types/lyrics";

/**
 * 查找下一个主行（非背景行）的索引
 * @param lines - 歌词行数组
 * @param from - 起始索引（不含）
 * @returns 下一个主行索引，未找到返回 -1
 */
const findNextMain = (lines: LyricLine[], from: number): number => {
  for (let j = from + 1; j < lines.length; j++) {
    if (!lines[j].isBG) return j;
  }
  return -1;
};

/**
 * 查找上一个主行（非背景行），跳过紧邻的背景行
 * @param lines - 歌词行数组
 * @param i - 当前行索引
 * @returns 上一个主行，未找到返回 null
 */
const findPrevMain = (lines: LyricLine[], i: number): LyricLine | null => {
  let idx = i - 1;
  if (idx >= 0 && lines[idx].isBG) idx--;
  return idx >= 0 ? lines[idx] : null;
};

/**
 * 优化歌词行的展示效果（原地修改）
 *
 * 依次执行五个优化步骤：
 * 1. **空格规范化** — 将单词内连续空格合并为一个
 * 2. **时间戳同步** — 保证行时间与词时间一致
 * 3. **背景行折叠** — 连续多行背景人声仅保留第一行
 * 4. **主行+背景行时间同步** — 合并主行和伴随背景行的时间窗口
 * 5. **重叠修正与提前开始** — 消除非刻意重叠，适当提前行开始时间以优化滚动体验
 *
 * @param lines - 待优化的歌词行数组
 */
export const optimizeLyricLines = (lines: LyricLine[]) => {
  // 1. 规范化空格
  for (const line of lines) {
    for (const word of line.words) {
      word.word = word.word.replace(/\s+/g, " ");
    }
  }

  // 2. 同步行/词时间戳
  for (const line of lines) {
    const words = line.words;
    if (
      words.length === 1 &&
      words[0].startTime === 0 &&
      words[0].endTime === 0 &&
      (line.startTime !== 0 || line.endTime !== 0)
    ) {
      words[0].startTime = line.startTime;
      words[0].endTime = line.endTime;
    } else if (words.length > 0) {
      line.startTime = words[0].startTime;
      line.endTime = words[words.length - 1].endTime;
    }
  }

  // 3. 连续背景行折叠（每个主行最多保留一行背景）
  let consecutiveBg = 0;
  for (const line of lines) {
    if (line.isBG) {
      if (++consecutiveBg > 1) line.isBG = false;
    } else {
      consecutiveBg = 0;
    }
  }

  // 4. 同步主行与紧随背景行的时间窗口
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.isBG) continue;

    const bg = lines[i + 1];
    if (!bg?.isBG) continue;

    const allWords = [...line.words, ...bg.words].filter((w) => w.word.trim().length > 0);
    if (allWords.length === 0) continue;

    let minStart = line.startTime;
    let maxEnd = line.endTime;
    for (const w of allWords) {
      if (w.startTime < minStart) minStart = w.startTime;
      if (w.endTime > maxEnd) maxEnd = w.endTime;
    }
    minStart = Math.min(minStart, bg.startTime);
    maxEnd = Math.max(maxEnd, bg.endTime);

    line.startTime = bg.startTime = minStart;
    line.endTime = bg.endTime = maxEnd;
  }

  // 5a. 修正非刻意重叠
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (line.isBG) continue;

    const nextIdx = findNextMain(lines, i);
    if (nextIdx === -1) continue;

    const nextLine = lines[nextIdx];
    const overlap = line.endTime - nextLine.startTime;
    if (overlap <= 0) continue;

    const nextDur = nextLine.endTime - nextLine.startTime;
    if (overlap > 100 && overlap > nextDur * 0.1) continue;

    line.endTime = nextLine.startTime;
    const attachedBg = lines[i + 1];
    if (attachedBg?.isBG) attachedBg.endTime = nextLine.startTime;
  }

  // 5b. 提前行开始时间（改善滚动跟手感）
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.isBG) continue;

    const prev = findPrevMain(lines, i);
    let advance: number;
    let boundary: number;

    if (prev) {
      const noOverlap = line.startTime >= prev.endTime;
      advance = noOverlap ? 1000 : 400;
      boundary = noOverlap ? prev.endTime : prev.startTime + (prev.endTime - prev.startTime) * 0.3;
    } else {
      advance = 1000;
      boundary = 0;
    }

    const newStart = Math.max(boundary, line.startTime - advance);
    if (newStart < line.startTime) line.startTime = newStart;

    const bg = lines[i + 1];
    if (bg?.isBG) bg.startTime = line.startTime;
  }
};
