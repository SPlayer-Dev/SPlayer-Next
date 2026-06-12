import type { LyricLine } from "@shared/types/lyrics";

/** 与前一行无重叠时的提前量（毫秒），与 AMLL tryAdvanceStartTime 的调校值一致 */
const ADVANCE_NO_OVERLAP = 600;
/** 与前一行有重叠时的提前量（毫秒） */
const ADVANCE_OVERLAP = 400;
/** 有重叠时的提前边界：前一行时长的比例位置 */
const OVERLAP_BOUNDARY_RATIO = 0.3;

/**
 * 滚动预滚：提前行开始时间，让滚动渲染器在开唱前先把视野滚到位
 *
 * 判定一律基于各行的原始时间（修改不影响后续行的判定）。
 * 相互重叠的连续主行（对唱段）合并为组，无重叠行的提前边界取组的最晚结束时间，
 * 避免把行提前进还在演唱中的对唱组。
 *
 * @param sourceLines - 规范化后的歌词行数组
 * @returns 应用预滚后的克隆行数组
 */
export const applyScrollPreroll = (sourceLines: readonly LyricLine[]): LyricLine[] => {
  const lines = sourceLines.map((line) => ({ ...line }));

  let prevLineStartTime = 0;
  let prevLineEndTime = 0;
  let prevGroupStartTime = 0;
  let prevGroupEndTime = 0;
  let hasPrevLine = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.isBG) continue;

    const originalStartTime = line.startTime;
    const originalEndTime = line.endTime;

    let advance: number;
    let boundary: number;

    if (hasPrevLine) {
      const hadGap = originalStartTime >= prevLineEndTime;
      if (hadGap) {
        advance = ADVANCE_NO_OVERLAP;
        boundary = prevGroupEndTime;
      } else {
        advance = ADVANCE_OVERLAP;
        boundary =
          prevLineStartTime + (prevLineEndTime - prevLineStartTime) * OVERLAP_BOUNDARY_RATIO;
      }
    } else {
      advance = ADVANCE_NO_OVERLAP;
      boundary = 0;
    }

    const newStart = Math.max(boundary, originalStartTime - advance);
    if (newStart < line.startTime) line.startTime = newStart;

    // 配对背景行随主行一起提前
    const bg = lines[lineIdx + 1];
    if (bg?.isBG) bg.startTime = line.startTime;

    // 更新重叠组：与上一组时间相交则并入，否则另起一组
    if (
      hasPrevLine &&
      originalStartTime < prevGroupEndTime &&
      originalEndTime > prevGroupStartTime
    ) {
      prevGroupStartTime = Math.min(prevGroupStartTime, originalStartTime);
      prevGroupEndTime = Math.max(prevGroupEndTime, originalEndTime);
    } else {
      prevGroupStartTime = originalStartTime;
      prevGroupEndTime = originalEndTime;
    }

    prevLineStartTime = originalStartTime;
    prevLineEndTime = originalEndTime;
    hasPrevLine = true;
  }

  return lines;
};
