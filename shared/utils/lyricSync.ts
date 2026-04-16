import type { LyricLine } from "@shared/types/lyrics";

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

const LAST_LINE_FALLBACK_MS = 8000;

/**
 * 将最后一行无效 endTime 截到曲目时长或 startTime+8s
 * @param lines 歌词行数组
 * @param trackDurationMs 曲目时长 ms
 */
export const clampLastLineEnd = (lines: LyricLine[], trackDurationMs?: number): LyricLine[] => {
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
