import type { AutoMixProfile } from "@shared/types/automix";

/**
 * 提取官方后处理的七帧局部峰，并合并同一拍的相邻峰
 * @param logits - 模型输出的逐帧分数
 * @returns 相对于分析窗口的毫秒拍点
 */
export const pickBeatPeaks = (logits: Float32Array): number[] => {
  const peaks: number[] = [];
  let sum = 0;
  let count = 0;
  let previous = -2;
  for (let index = 0; index < logits.length; index++) {
    const value = logits[index];
    if (value <= 0 || !Number.isFinite(value)) continue;
    let peak = true;
    for (
      let other = Math.max(0, index - 3);
      other <= Math.min(logits.length - 1, index + 3);
      other++
    ) {
      if (logits[other] > value) peak = false;
    }
    if (!peak) continue;
    if (count && index - previous > 1) {
      peaks.push((sum / count) * 20);
      sum = 0;
      count = 0;
    }
    sum += index;
    count++;
    previous = index;
  }
  if (count) peaks.push((sum / count) * 20);
  return peaks;
};

/**
 * 在连续稳定的局部拍点上拟合周期，帧量化误差不视为速度漂移
 * @param beats - 绝对毫秒拍点
 * @param tail - 曲尾优先采用较晚的稳定片段，避免把前段网格外推到尾奏
 * @returns 周期、可信区间与区间内的稳定性
 */
export const measureBeatPeriod = (
  beats: readonly number[],
  tail = false,
): Pick<AutoMixProfile, "periodMs" | "stability" | "gridStartMs" | "gridEndMs"> => {
  const unknown = { periodMs: null, stability: 0, gridStartMs: null, gridEndMs: null };
  if (beats.length < 8) return unknown;
  const intervals = beats.slice(1).map((beat, index) => beat - beats[index]);
  const sorted = [...intervals].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median < 250 || median > 1500) return unknown;
  let start = 0;
  let bestStart = 0;
  let bestEnd = 0;
  for (let index = 0; index < intervals.length; index++) {
    // 两端峰值各有二十毫秒量化误差，快速节拍不能只用百分比筛选
    if (Math.abs(intervals[index] - median) > Math.max(40, median * 0.06)) start = index + 1;
    const length = index + 1 - start;
    if (
      length >= 7 &&
      beats[index + 1] - beats[start] >= 3000 &&
      (tail || length > bestEnd - bestStart)
    ) {
      bestStart = start;
      bestEnd = index + 1;
    }
  }
  const grid = beats.slice(bestStart, bestEnd + 1);
  if (grid.length < 8 || grid[grid.length - 1] - grid[0] < 3000) return unknown;
  const meanIndex = (grid.length - 1) / 2;
  const meanTime = grid.reduce((sum, value) => sum + value, 0) / grid.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < grid.length; index++) {
    numerator += (index - meanIndex) * (grid[index] - meanTime);
    denominator += (index - meanIndex) ** 2;
  }
  const periodMs = numerator / denominator;
  const stability =
    grid.filter(
      (beat, index) =>
        Math.abs(beat - meanTime - (index - meanIndex) * periodMs) <= Math.max(40, periodMs * 0.06),
    ).length / grid.length;
  return { periodMs, stability, gridStartMs: grid[0], gridEndMs: grid[grid.length - 1] };
};
