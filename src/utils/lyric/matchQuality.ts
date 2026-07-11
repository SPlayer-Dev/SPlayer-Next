import type { LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { parseLyric } from "./parse";

const MIN_CONTENT_SCORE = 0.82;
const MAX_ANCHOR_DIFF_MS = 3000;
const MAX_P90_DIFF_MS = 2500;
const MAX_TIMELINE_DRIFT_MS = 4000;
const MIN_TIMELINE_RATIO = 0.985;
const MAX_TIMELINE_RATIO = 1.015;
const METADATA_LINE_RE =
  /^(?:作词|作曲|编曲|制作人|混音|母带|录音|词|曲|composer|lyricist|arranger|producer|mixed by)\s*[:：]/i;

interface ComparableLine {
  text: string;
  startTime: number;
  endTime: number;
}

interface MatchAnchor {
  referenceStart: number;
  candidateStart: number;
}

export interface LyricMatchMetrics {
  durationDiffMs?: number;
  durationLimitMs?: number;
  contentScore?: number;
  anchorCount?: number;
  timelineCoverage?: number;
  withinTimeRatio?: number;
  p90DiffMs?: number;
  timelineDriftMs?: number;
  timelineRatio?: number;
}

export interface LyricMatchDecision {
  status: "accepted" | "rejected" | "uncertain";
  reason: string;
  validationKey: string;
  metrics: LyricMatchMetrics;
}

/** 归一化歌词正文，仅用于跨来源一致性比较 */
const normalizeText = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");

/** 提取参与匹配的主歌词行 */
const toComparableLines = (lines: LyricLine[]): ComparableLine[] =>
  lines.flatMap((line) => {
    if (line.isBG) return [];
    const raw = line.words
      .map((word) => word.word)
      .join("")
      .trim();
    if (!raw || METADATA_LINE_RE.test(raw)) return [];
    const text = normalizeText(raw);
    if (text.length < 2) return [];
    return [{ text, startTime: line.startTime, endTime: line.endTime }];
  });

/** 计算两个短文本的归一化编辑相似度 */
const textSimilarity = (left: string, right: string): number => {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let j = 0; j <= right.length; j++) previous[j] = j;
  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.set(current);
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
};

const joinSpan = (lines: ComparableLine[], start: number, count: number): string =>
  lines
    .slice(start, start + count)
    .map((line) => line.text)
    .join("");

/**
 * 有序对齐歌词行，并允许相邻两行互相合并，兼容不同平台的断句差异
 * @returns 文本匹配权重与时间锚点
 */
const alignLines = (
  reference: ComparableLine[],
  candidate: ComparableLine[],
): { score: number; anchors: MatchAnchor[] } => {
  const width = candidate.length + 1;
  const size = (reference.length + 1) * width;
  const scores = new Float64Array(size);
  const prevReference = new Uint8Array(size);
  const prevCandidate = new Uint8Array(size);

  const update = (
    fromReference: number,
    fromCandidate: number,
    referenceCount: number,
    candidateCount: number,
    addedScore: number,
  ): void => {
    const nextReference = fromReference + referenceCount;
    const nextCandidate = fromCandidate + candidateCount;
    const from = fromReference * width + fromCandidate;
    const next = nextReference * width + nextCandidate;
    const score = scores[from] + addedScore;
    if (score <= scores[next]) return;
    scores[next] = score;
    prevReference[next] = referenceCount;
    prevCandidate[next] = candidateCount;
  };

  for (let i = 0; i <= reference.length; i++) {
    for (let j = 0; j <= candidate.length; j++) {
      if (i < reference.length) update(i, j, 1, 0, 0);
      if (j < candidate.length) update(i, j, 0, 1, 0);
      for (let referenceCount = 1; referenceCount <= 2; referenceCount++) {
        if (i + referenceCount > reference.length) break;
        for (let candidateCount = 1; candidateCount <= 2; candidateCount++) {
          if (j + candidateCount > candidate.length) break;
          const referenceText = joinSpan(reference, i, referenceCount);
          const candidateText = joinSpan(candidate, j, candidateCount);
          const similarity = textSimilarity(referenceText, candidateText);
          if (similarity < 0.68) continue;
          update(
            i,
            j,
            referenceCount,
            candidateCount,
            Math.min(referenceText.length, candidateText.length) * similarity,
          );
        }
      }
    }
  }

  const anchors: MatchAnchor[] = [];
  let i = reference.length;
  let j = candidate.length;
  while (i > 0 || j > 0) {
    const index = i * width + j;
    const referenceCount = prevReference[index];
    const candidateCount = prevCandidate[index];
    if (referenceCount === 0 && candidateCount === 0) break;
    const previousI = i - referenceCount;
    const previousJ = j - candidateCount;
    if (referenceCount > 0 && candidateCount > 0) {
      anchors.push({
        referenceStart: reference[previousI].startTime,
        candidateStart: candidate[previousJ].startTime,
      });
    }
    i = previousI;
    j = previousJ;
  }
  anchors.reverse();
  return { score: scores[size - 1], anchors };
};

/** 为基准歌词生成轻量摘要，绑定已经验证的模糊匹配缓存 */
export const buildLyricValidationKey = (input: LyricInput, format: LyricFormat): string => {
  const lines = toComparableLines(parseLyric(input, format));
  const payload = lines.map((line) => `${Math.round(line.startTime / 500)}:${line.text}`).join("|");
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `lyric-v1:${(hash >>> 0).toString(16)}`;
};

/**
 * 检测高阶歌词是否与基准歌词属于同一录音版本
 * @param referenceInput - 基准歌词
 * @param referenceFormat - 基准歌词格式
 * @param candidateInput - 候选歌词
 * @param candidateFormat - 候选歌词格式
 * @param referenceDuration - 基准歌曲时长（毫秒）
 * @param candidateDuration - 候选歌曲时长（毫秒）
 */
export const evaluateLyricMatch = (
  referenceInput: LyricInput,
  referenceFormat: LyricFormat,
  candidateInput: LyricInput,
  candidateFormat: LyricFormat,
  referenceDuration?: number,
  candidateDuration?: number,
): LyricMatchDecision => {
  const validationKey = buildLyricValidationKey(referenceInput, referenceFormat);
  const metrics: LyricMatchMetrics = {};

  if (referenceDuration && candidateDuration) {
    metrics.durationDiffMs = Math.abs(referenceDuration - candidateDuration);
    metrics.durationLimitMs = Math.max(8000, referenceDuration * 0.04);
    if (metrics.durationDiffMs > metrics.durationLimitMs) {
      return { status: "rejected", reason: "duration_mismatch", validationKey, metrics };
    }
  }

  const reference = toComparableLines(parseLyric(referenceInput, referenceFormat));
  const candidate = toComparableLines(parseLyric(candidateInput, candidateFormat));
  if (reference.length < 3 || candidate.length < 3) {
    return { status: "uncertain", reason: "insufficient_lines", validationKey, metrics };
  }

  const aligned = alignLines(reference, candidate);
  const referenceChars = reference.reduce((sum, line) => sum + line.text.length, 0);
  const candidateChars = candidate.reduce((sum, line) => sum + line.text.length, 0);
  metrics.contentScore = (2 * aligned.score) / (referenceChars + candidateChars);
  if (metrics.contentScore < MIN_CONTENT_SCORE) {
    return { status: "rejected", reason: "content_mismatch", validationKey, metrics };
  }

  const anchors = aligned.anchors.filter(
    (anchor) => Number.isFinite(anchor.referenceStart) && Number.isFinite(anchor.candidateStart),
  );
  metrics.anchorCount = anchors.length;
  const timelineDuration =
    referenceDuration ||
    reference[reference.length - 1].endTime ||
    reference.at(-1)?.startTime ||
    0;
  const minAnchors = timelineDuration > 0 && timelineDuration < 60_000 ? 3 : 6;
  if (anchors.length < minAnchors) {
    return { status: "uncertain", reason: "insufficient_anchors", validationKey, metrics };
  }

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const referenceSpan = last.referenceStart - first.referenceStart;
  const candidateSpan = last.candidateStart - first.candidateStart;
  metrics.timelineCoverage = timelineDuration > 0 ? referenceSpan / timelineDuration : 0;
  const minimumCoverage = timelineDuration > 0 && timelineDuration < 60_000 ? 0.35 : 0.5;
  if (metrics.timelineCoverage < minimumCoverage) {
    return {
      status: "uncertain",
      reason: "insufficient_timeline_coverage",
      validationKey,
      metrics,
    };
  }

  const differences = anchors
    .map((anchor) => Math.abs(anchor.candidateStart - anchor.referenceStart))
    .sort((left, right) => left - right);
  metrics.withinTimeRatio =
    differences.filter((difference) => difference <= MAX_ANCHOR_DIFF_MS).length /
    differences.length;
  metrics.p90DiffMs = differences[Math.max(0, Math.ceil(differences.length * 0.9) - 1)];
  const firstOffset = first.candidateStart - first.referenceStart;
  const lastOffset = last.candidateStart - last.referenceStart;
  metrics.timelineDriftMs = Math.abs(lastOffset - firstOffset);
  metrics.timelineRatio = referenceSpan > 0 ? candidateSpan / referenceSpan : 0;

  if (
    metrics.withinTimeRatio < 0.8 ||
    metrics.p90DiffMs > MAX_P90_DIFF_MS ||
    metrics.timelineDriftMs > MAX_TIMELINE_DRIFT_MS ||
    metrics.timelineRatio < MIN_TIMELINE_RATIO ||
    metrics.timelineRatio > MAX_TIMELINE_RATIO
  ) {
    return { status: "rejected", reason: "timeline_mismatch", validationKey, metrics };
  }

  return { status: "accepted", reason: "matched", validationKey, metrics };
};
