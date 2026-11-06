import type { AutoMixPlan, AutoMixProfile } from "@shared/types/automix";
import { measureMixWindow } from "./features";

/** 分轨复核前的选点与速度候选，尚未生成可提交给引擎的声部包络 */
export type AutoMixCandidate = Omit<AutoMixPlan, "envelopes" | "stems">;

/**
 * 仅在用户使用正常速度和音调时允许 AutoMix
 * @param speed - 用户播放速度
 * @param pitch - 用户音调偏移
 * @returns 是否可以安排自动混音
 */
export const canAutoMix = (speed: number, pitch: number): boolean =>
  Math.abs(speed - 1) < 0.0001 && pitch === 0;

/** 原生引擎接受的最长交接 */
const MAX_MIX_MS = 18_000;
/** 音级相似度达到此值视为调性相容，可整句融合 */
const CONSONANT_AFFINITY = 0.7;
/** 无音级信息时的中性相似度 */
const NEUTRAL_AFFINITY = 0.75;

/** 打分中的一个候选交接窗口与两曲整体电平 */
interface CandidateWindow {
  start: number;
  finish: number;
  cue: number;
  length: number;
  bar: number;
  bodyEnd: number;
  outgoingLevel: number;
  incomingLevel: number;
}

/**
 * 综合长度、收尾位置、能量、乐段边界与调性给候选打分，越低越好
 * @param outgoing - 当前曲尾部证据
 * @param incoming - 下一曲首部证据
 * @param window - 候选窗口
 * @returns 分数与两段的音级相似度
 */
const scoreCandidate = (
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
  window: CandidateWindow,
): { score: number; affinity: number } => {
  const { start, finish, cue, length, bar, bodyEnd } = window;
  const outgoingWindow = measureMixWindow(outgoing, start, finish);
  const incomingWindow = measureMixWindow(incoming, cue, cue + length);
  const hasTone =
    Math.hypot(...outgoingWindow.chroma) > 0 && Math.hypot(...incomingWindow.chroma) > 0;
  const affinity = hasTone
    ? outgoingWindow.chroma.reduce(
        (sum, value, pitch) => sum + value * incomingWindow.chroma[pitch],
        0,
      )
    : NEUTRAL_AFFINITY;
  // 调性相容时偏好整句长融合，冲突时偏好短交接
  const preferred = affinity >= CONSONANT_AFFINITY ? 16_000 : 8000;
  const energyCost =
    Math.max(0, Math.log(window.outgoingLevel / outgoingWindow.level)) +
    Math.max(0, Math.log(window.incomingLevel / incomingWindow.level));
  const middle = (start + finish) / 2;
  const boundaryCost = outgoing.boundaries.length
    ? Math.min(...outgoing.boundaries.map((time) => Math.abs(time - middle))) / bar
    : 0;
  const score =
    Math.abs(length - preferred) / preferred +
    (Math.abs(finish - bodyEnd) / bar) * 0.2 +
    energyCost * 0.4 +
    Math.abs(Math.log(outgoingWindow.level / incomingWindow.level)) * 0.1 +
    Math.min(2, boundaryCost) * 0.1 +
    ((1 - affinity) * length) / 8000;
  return { score, affinity };
};

/**
 * 只在两曲拍速与重拍都可信时安排对拍乐句，无法对拍时由设置决定交叉过渡或直接切歌
 * @param outgoing - 当前曲尾部证据
 * @param incoming - 下一曲首部证据
 * @param currentEndMs - 当前曲目或 CUE 的有效终点
 * @returns 待分轨复核的对拍候选，无法对拍时为空
 */
export const planAutoMix = (
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
  currentEndMs: number,
): AutoMixCandidate | null => {
  const endMs = Math.min(currentEndMs, outgoing.lastAudibleMs + 200, outgoing.endMs);
  const entry = Math.max(incoming.startMs, incoming.firstAudibleMs - 100);
  const bodyEnd = Math.min(endMs, outgoing.bodyEndMs + 300);
  let selected: AutoMixCandidate | null = null;
  if (
    outgoing.periodMs &&
    incoming.periodMs &&
    outgoing.stability >= 0.85 &&
    incoming.stability >= 0.85 &&
    outgoing.gridStartMs != null &&
    outgoing.gridEndMs != null &&
    incoming.gridStartMs != null &&
    incoming.gridEndMs != null
  ) {
    const rates = [0.5, 1, 2].map((fold) => (outgoing.periodMs! / incoming.periodMs!) * fold);
    const rate = rates.sort(
      (left, right) => Math.abs(Math.log(left)) - Math.abs(Math.log(right)),
    )[0];
    const commonBeat = Math.max(outgoing.periodMs / rate, incoming.periodMs);
    const bar = commonBeat * 4;
    const downbeats = [outgoing, incoming].map((profile) => {
      const times = profile.downbeats.filter(
        (time) => time >= profile.gridStartMs! && time <= profile.gridEndMs!,
      );
      const barMs = profile.periodMs! * 4;
      // 相邻两个小节提供局部支持，不让远处的重拍相位变化或零散误检否定当前乐句
      return times.filter((time) => {
        const neighbors = new Set<number>();
        for (const other of times) {
          const offset = Math.round((other - time) / barMs);
          if (
            offset !== 0 &&
            Math.abs(offset) <= 2 &&
            Math.abs(other - time - offset * barMs) <= Math.max(40, profile.periodMs! * 0.06)
          )
            neighbors.add(offset);
        }
        return neighbors.size >= 2;
      });
    });
    const anchor = downbeats[1].find((time) => time >= Math.max(entry, incoming.gridStartMs!));
    if (Math.abs(rate - 1) <= 0.08 + 1e-9 && anchor != null) {
      const outgoingLevel = measureMixWindow(outgoing, outgoing.startMs, bodyEnd).level;
      const incomingLevel = measureMixWindow(incoming, entry, incoming.endMs).level;
      // 原有入口优先，无法成句时再从首个可靠小节入场
      const syncedEntry = anchor > entry + bar ? anchor : entry;
      for (const cue of new Set([syncedEntry, anchor])) {
        let bestScore = Infinity;
        for (const bars of [8, 4, 2]) {
          const phraseLength = bars * bar;
          if (
            phraseLength > MAX_MIX_MS ||
            phraseLength < 3500 ||
            cue + phraseLength > Math.min(incoming.endMs - 300, incoming.gridEndMs + commonBeat)
          )
            continue;
          for (const beat of downbeats[0]) {
            const start = beat - (anchor - cue) * rate;
            const length = Math.min(phraseLength, (endMs - start) / rate);
            const finish = start + length * rate;
            if (start < outgoing.startMs + 200 || beat < outgoing.gridStartMs) continue;
            if (phraseLength - length > 20 || length < 3500) continue;
            // 先交出鼓，再让自由速度的尾奏自然退出
            const gridRequired = start + bar * rate;
            if (gridRequired > outgoing.gridEndMs + outgoing.periodMs) continue;
            if (finish < bodyEnd - outgoing.periodMs * 2 || finish < currentEndMs - 16_000)
              continue;
            const { score, affinity } = scoreCandidate(outgoing, incoming, {
              start,
              finish,
              cue,
              length,
              bar,
              bodyEnd,
              outgoingLevel,
              incomingLevel,
            });
            if (score >= bestScore) continue;
            bestScore = score;
            selected = {
              outStartMs: start,
              inStartMs: cue,
              durationMs: length,
              outgoingRate: rate,
              levelRatio: 1,
              strategy: affinity >= CONSONANT_AFFINITY ? "phrase" : "handoff",
            };
          }
        }
        if (selected) break;
      }
    }
  }
  return selected;
};

/** 两个乐句乘以不变速时的 0.6 缩短系数，取整到小节，与参考实现的漂移档一致 */
const BRIDGE_BEATS = 20;

/**
 * 拍速差在四分之一以内但无法对拍时安排原速桥接，鼓与贝斯不重叠换手，只让旋律层短暂叠加
 * @param outgoing - 当前曲尾部证据
 * @param incoming - 下一曲首部证据
 * @param currentEndMs - 当前曲目或 CUE 的有效终点
 * @returns 待分轨复核的原速候选，速度不可信、相差过大或尾部前奏不足时为空
 */
export const planAutoMixBridge = (
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
  currentEndMs: number,
): AutoMixCandidate | null => {
  if (
    !outgoing.periodMs ||
    !incoming.periodMs ||
    outgoing.stability < 0.85 ||
    incoming.stability < 0.85
  )
    return null;
  const ratio = outgoing.periodMs / incoming.periodMs;
  // 相差超过四分之一时，即使鼓不重叠，伴奏里的节奏型也会在重叠段互相打架
  if (Math.min(...[0.5, 1, 2].map((fold) => Math.abs(ratio * fold - 1))) > 0.25 + 1e-9) return null;
  const endMs = Math.min(currentEndMs, outgoing.lastAudibleMs + 200, outgoing.endMs);
  const entry = Math.max(incoming.startMs, incoming.firstAudibleMs - 100);
  const bodyEnd = Math.min(endMs, outgoing.bodyEndMs + 300);
  const bar = incoming.periodMs * 4;
  const room = Math.min(
    incoming.periodMs * BRIDGE_BEATS,
    MAX_MIX_MS,
    endMs - outgoing.startMs - 200,
    incoming.endMs - 300 - entry,
  );
  const durationMs = Math.floor(room / bar) * bar;
  if (durationMs < Math.max(3500, bar * 2)) return null;
  // 前半段跨在主体末尾，节奏换手时当前曲只剩尾奏与残响
  const outStartMs = Math.max(
    outgoing.startMs + 200,
    Math.min(endMs, bodyEnd + durationMs / 2) - durationMs,
  );
  return {
    outStartMs,
    inStartMs: entry,
    durationMs,
    outgoingRate: 1,
    levelRatio: 1,
    strategy: "bridge",
  };
};
