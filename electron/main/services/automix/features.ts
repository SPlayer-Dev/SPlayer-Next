import type { JsAutoMixFeatures } from "@splayer/audio-engine";
import type { AutoMixProfile } from "@shared/types/automix";
import { measureBeatPeriod, pickBeatPeaks } from "./beats";

/**
 * 测量实际候选片段的有效电平与音级分布，避免残响和空前奏支配决策
 * @param profile - 有限分析档案
 * @param startMs - 片段绝对起点
 * @param endMs - 片段绝对终点
 * @returns 有效电平与归一化音级能量
 */
export const measureMixWindow = (
  profile: AutoMixProfile,
  startMs: number,
  endMs: number,
): { level: number; chroma: number[] } => {
  const first = Math.max(0, Math.floor((startMs - profile.startMs) / 100));
  const last = Math.min(profile.levels.length, Math.ceil((endMs - profile.startMs) / 100));
  const levels = profile.levels.slice(first, last).sort((left, right) => left - right);
  const level = Math.max(0.001, levels[Math.floor(levels.length * 0.65)] ?? 0);
  const chroma = Array<number>(12).fill(0);
  for (let index = first; index < last; index++) {
    if (profile.levels[index] < level * 0.25) continue;
    for (let pitch = 0; pitch < 12; pitch++) chroma[pitch] += profile.chroma[index * 12 + pitch];
  }
  const norm = Math.hypot(...chroma);
  if (norm > 0) for (let pitch = 0; pitch < 12; pitch++) chroma[pitch] /= norm;
  return { level, chroma };
};

/**
 * 将原生频谱和模型预测转换为有限的音乐档案，不保留模型输入
 * @param features - 原生窗口特征，时间单位为秒
 * @param scores - 交错排列的拍点和重拍预测
 * @param tail - 是否优先使用靠近曲尾的稳定节拍
 * @returns 使用绝对毫秒时间的选点证据
 */
export const createAutoMixProfile = (
  features: Omit<JsAutoMixFeatures, "mel">,
  scores: Float32Array,
  tail = false,
): AutoMixProfile => {
  const startMs = features.startSeconds * 1000;
  const levels = Array.from(features.levels);
  const sorted = [...levels].sort((left, right) => left - right);
  const threshold = Math.max(0.001, sorted[Math.floor(sorted.length * 0.8)] * 0.25);
  let bodyEnd = -1;
  let run = 0;
  for (const [index, level] of levels.entries()) {
    run = level >= threshold ? run + 1 : 0;
    if (run >= 3) bodyEnd = index + 1;
  }
  const beats = pickBeatPeaks(scores.filter((_, index) => index % 2 === 0)).map(
    (time) => time + startMs,
  );
  const rawDownbeats = pickBeatPeaks(scores.filter((_, index) => index % 2 === 1));
  const period = measureBeatPeriod(beats, tail);
  let snap = (beat: number): number => beat;
  const { periodMs, gridStartMs, gridEndMs } = period;
  if (periodMs && gridStartMs != null && gridEndMs != null) {
    const grid = beats.filter((beat) => beat >= gridStartMs && beat <= gridEndMs);
    // 网格内的重拍落到整段拟合直线上，单拍的帧量化和前奏起音偏差不会传给对拍相位
    const origin =
      grid.reduce((sum, beat, index) => sum + beat - index * periodMs, 0) / grid.length;
    snap = (beat) =>
      beat >= gridStartMs - 1 && beat <= gridEndMs + 1
        ? origin + Math.round((beat - origin) / periodMs) * periodMs
        : beat;
  }
  const downbeats = beats.length
    ? [
        ...new Set(
          rawDownbeats.flatMap((time) => {
            const nearest = beats.reduce((best, beat) =>
              Math.abs(beat - startMs - time) < Math.abs(best - startMs - time) ? beat : best,
            );
            return Math.abs(nearest - startMs - time) <= 80 ? [snap(nearest)] : [];
          }),
        ),
      ]
    : [];
  const chroma = Array.from(features.chroma);
  const novelty = levels.map((_, index) => {
    if (index < 12 || index + 12 >= levels.length) return 0;
    let distance = 0;
    for (let pitch = 0; pitch < 12; pitch++) {
      let before = 0;
      let after = 0;
      for (let offset = 0; offset < 12; offset++) {
        before += chroma[(index - 12 + offset) * 12 + pitch];
        after += chroma[(index + offset) * 12 + pitch];
      }
      distance += ((after - before) / 12) ** 2;
    }
    const before = levels.slice(index - 12, index).reduce((sum, value) => sum + value, 0);
    const after = levels.slice(index, index + 12).reduce((sum, value) => sum + value, 0);
    return (
      Math.sqrt(distance) + Math.min(2, Math.abs(Math.log((after + 0.01) / (before + 0.01)))) * 0.3
    );
  });
  const boundaries = novelty.flatMap((value, index) =>
    value > 0.35 && value === Math.max(...novelty.slice(Math.max(0, index - 15), index + 16))
      ? [startMs + index * 100]
      : [],
  );
  return {
    startMs,
    endMs: features.endSeconds * 1000,
    firstAudibleMs: features.firstAudibleSeconds * 1000,
    lastAudibleMs: features.lastAudibleSeconds * 1000,
    bodyEndMs:
      bodyEnd < 0
        ? features.lastAudibleSeconds * 1000
        : Math.min(features.endSeconds * 1000, startMs + bodyEnd * 100),
    levels,
    chroma,
    boundaries,
    downbeats,
    ...period,
  };
};
