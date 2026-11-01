import type { AutoMixEnvelope, AutoMixArrangement, AutoMixProfile } from "@shared/types/automix";
import type { AutoMixCandidate } from "./planner";

/** 当前曲各声部在包络数组中的下标，下一曲同名声部再加 INCOMING */
export const STEM = { drums: 0, bass: 1, vocals: 2, other: 3 } as const;
export const INCOMING = 4;

/**
 * 将对拍候选转换为按音乐时间错开的鼓、低频、人声与伴奏包络
 * @param plan - 已通过音频边界验证的交接计划
 * @param outgoing - 当前曲的尾部音乐证据
 * @param incoming - 下一曲的首部音乐证据
 * @returns 只含有限区间的可执行编排，不在音频回调做选点
 */
export const arrangeAutoMix = (
  plan: AutoMixCandidate,
  outgoing: AutoMixProfile,
  incoming: AutoMixProfile,
): AutoMixArrangement => {
  const duration = plan.durationMs;
  const beat = Math.max(outgoing.periodMs! / plan.outgoingRate, incoming.periodMs!);
  const bar = beat * 4;
  const gridEnd = (outgoing.gridEndMs! - plan.outStartMs) / plan.outgoingRate;
  const target = Math.min(Math.max(duration * 0.4, duration - bar * 2.5), gridEnd);
  const swaps = incoming.downbeats
    .map((time) => time - plan.inStartMs)
    .filter((time) => time >= beat && time <= Math.min(duration * 0.65, gridEnd));
  const drumAt = swaps.length
    ? swaps.reduce((best, time) =>
        Math.abs(time - target) < Math.abs(best - target) ? time : best,
      )
    : target;
  const bassAt = Math.min(duration * 0.8, drumAt + bar);
  const width = Math.min(400, beat / 2);
  const envelopes: AutoMixEnvelope[] = [
    { startMs: drumAt - width / 2, endMs: drumAt + width / 2 },
    { startMs: bassAt - width / 2, endMs: bassAt + width / 2 },
    { startMs: drumAt, endMs: Math.min(duration, drumAt + bar / 2) },
    { startMs: Math.max(0, drumAt - bar), endMs: duration },
    // 下一曲的鼓提前两小节对拍叠入，交换点不再是一瞬间的硬切
    { startMs: Math.max(0, drumAt - bar * 2), endMs: drumAt + width / 2 },
    { startMs: bassAt - width / 2, endMs: bassAt + width / 2 },
    {
      startMs: Math.min(duration - 200, drumAt + bar / 2),
      endMs: Math.min(duration, drumAt + bar / 2 + 300),
    },
    { startMs: 0, endMs: Math.min(duration, drumAt + bar) },
  ];
  // 调性差异较大时让鼓先融合，旋律与贝斯一起换手，避免整段伴奏持续冲突
  if (plan.strategy === "handoff") {
    const melody = {
      startMs: Math.max(0, bassAt - beat),
      endMs: Math.min(duration, bassAt + beat),
    };
    envelopes[STEM.other] = melody;
    envelopes[STEM.other + INCOMING] = melody;
  }
  return { ...plan, envelopes };
};

/**
 * 原速桥接的声部包络：两套鼓与贝斯在下一曲的重拍上瞬时换手，旋律层交错淡化
 * @param plan - 原速候选
 * @param incoming - 下一曲首部证据，用于把节奏换手落在它自己的重拍上
 * @returns 人声区间待复核的编排
 */
export const arrangeAutoMixBridge = (
  plan: AutoMixCandidate,
  incoming: AutoMixProfile,
): AutoMixArrangement => {
  const duration = plan.durationMs;
  const target = duration * 0.45;
  const swap =
    incoming.downbeats
      .map((time) => time - plan.inStartMs)
      .filter((time) => time >= duration * 0.3 && time <= duration * 0.6)
      .sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0] ?? target;
  // 两曲不对拍，节奏声部只允许约四分之一秒的交叠
  const rhythm = { startMs: swap - 125, endMs: swap + 125 };
  const vocals = { startMs: swap, endMs: swap + 600 };
  return {
    ...plan,
    envelopes: [
      rhythm,
      rhythm,
      vocals,
      { startMs: duration * 0.35, endMs: duration },
      rhythm,
      rhythm,
      vocals,
      { startMs: 0, endMs: duration * 0.6 },
    ],
  };
};
