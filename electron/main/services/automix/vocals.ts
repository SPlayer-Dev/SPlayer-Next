import { arrangeAutoMix, arrangeAutoMixBridge, INCOMING, STEM } from "./arrangement";
import type { AutoMixCandidate } from "./planner";
import type { AutoMixArrangement, AutoMixProfile } from "@shared/types/automix";

/** 有限窗口的人声强度，低电平垫唱和分离串音不等同于完整主唱 */
export interface VocalActivity {
  startMs: number;
  weights: number[];
}

/**
 * 用分离人声与原曲的相对电平估计活动区间，忽略短暂串音
 * @param profile - 原曲的有限电平档案
 * @param levels - 分离窗口内每百毫秒的人声电平
 * @param startMs - 分离窗口的绝对毫秒起点
 * @returns 音源绝对时间轴上的人声强度
 */
export const measureVocalActivity = (
  profile: Pick<AutoMixProfile, "startMs" | "levels">,
  levels: number[],
  startMs: number,
): VocalActivity => {
  const sorted = [...levels].sort((left, right) => left - right);
  const reference = Math.max(0.01, sorted[Math.floor(sorted.length * 0.9)] ?? 0);
  const threshold = Math.max(0.003, reference * 0.06);
  const weights = levels.map((level, index) => {
    const at = Math.floor((startMs + index * 100 - profile.startMs) / 100);
    const mix = profile.levels[at] ?? 0;
    return level < threshold || mix < 0.003
      ? 0
      : Math.min(1, (level / reference) ** 2) * Math.min(1, level / (mix * 0.45));
  });
  for (let index = 0; index < weights.length; index++) {
    if (weights[index] < 0.08) continue;
    const start = index;
    while (
      index + 1 < weights.length &&
      weights.slice(index + 1, index + 4).some((weight) => weight >= 0.08)
    )
      index++;
    if (index - start < 2) {
      weights.fill(0, start, index + 1);
    }
  }
  return { startMs, weights };
};

/**
 * 测量被跳过或压低的等效主唱时长，微弱垫唱的代价低于持续主唱
 * @param activity - 音频实测的人声强度
 * @param startMs - 音源绝对起点
 * @param endMs - 音源绝对终点
 * @returns 按人声强度加权的毫秒数
 */
export const vocalExposure = (activity: VocalActivity, startMs: number, endMs: number): number =>
  activity.weights.reduce((sum, weight, index) => {
    const at = activity.startMs + index * 100;
    return sum + weight * Math.max(0, Math.min(endMs, at + 100) - Math.max(startMs, at));
  }, 0);

/**
 * 依据收句和实际起音安排对拍路径的两路人声
 * @param plan - 已选中的背景衔接
 * @param outgoing - 当前曲音频人声活动
 * @param incoming - 下一曲音频人声活动
 * @param beatMs - 混音时间轴上的拍长
 * @returns 保持背景编排的人声交接计划
 */
export const arrangeVocalHandoff = (
  plan: AutoMixArrangement,
  outgoing: VocalActivity,
  incoming: VocalActivity,
  beatMs = 500,
): AutoMixArrangement => {
  const fadeMs = Math.min(plan.durationMs, Math.max(400, Math.min(900, beatMs * 1.5)));
  const voices = [outgoing, incoming].map((activity, side) =>
    activity.weights
      .map((weight, index) => ({
        time:
          (activity.startMs + index * 100 + 50 - (side ? plan.inStartMs : plan.outStartMs)) /
          (side ? 1 : plan.outgoingRate),
        weight,
      }))
      .filter(({ time }) => time >= 0 && time < plan.durationMs),
  );
  let best = { score: Infinity, startMs: 0, endMs: fadeMs };
  for (let center = 0; center <= plan.durationMs + 50; center += 100) {
    const startMs = Math.max(0, Math.min(plan.durationMs - fadeMs, center - fadeMs / 2));
    const endMs = startMs + fadeMs;
    // 允许少量前句取舍，避免通过压低下一首整段主唱来制造交接空间
    if (vocalExposure(incoming, plan.inStartMs, plan.inStartMs + endMs) > 1500) continue;
    let score = Math.abs(center - plan.durationMs * 0.5) * 0.002;
    for (const [side, cells] of voices.entries()) {
      for (const { time, weight } of cells) {
        const phase = Math.max(0, Math.min(1, (time - startMs) / fadeMs));
        const gain = side ? Math.sin((phase * Math.PI) / 2) : Math.cos((phase * Math.PI) / 2);
        // 呼吸间隙优先，避免在人声最强的字音中间完成淡化
        score += weight * (1 - gain * gain + Math.sin(phase * Math.PI) ** 2) * 100;
      }
    }
    if (score < best.score) best = { score, startMs, endMs };
  }
  const envelopes = [...plan.envelopes];
  envelopes[STEM.vocals] = { startMs: best.startMs, endMs: best.endMs };
  envelopes[STEM.vocals + INCOMING] = { startMs: best.startMs, endMs: best.endMs };
  return { ...plan, envelopes };
};

/**
 * 保留既有对拍编排，并拒绝依赖大段压低主唱才能成立的交接
 * @param plan - 已通过节奏检查的计划
 * @param profiles - 两路有限音乐档案
 * @param voices - 与分离窗口对应的主唱活动
 * @returns 可执行计划及两路等效主唱损失，冲突无法消除时不返回计划
 */
export const refineAutoMixVocals = (
  plan: AutoMixCandidate,
  profiles: AutoMixProfile[],
  voices: VocalActivity[],
): { plan?: AutoMixArrangement; vocalLossMs: number[] } => {
  if (plan.strategy === "bridge") {
    const bridged = arrangeVocalHandoff(
      arrangeAutoMixBridge(plan, profiles[1]),
      voices[0],
      voices[1],
    );
    const vocalLossMs = measureAutoMixVocalLoss(bridged, voices);
    if (vocalLossMs.some((loss) => loss > 1000)) return { vocalLossMs };
    return { plan: bridged, vocalLossMs };
  }
  const beat = Math.max(profiles[0].periodMs! / plan.outgoingRate, profiles[1].periodMs!);
  let result = arrangeVocalHandoff(
    arrangeAutoMix(plan, profiles[0], profiles[1]),
    voices[0],
    voices[1],
    beat,
  );
  const lostTail = vocalExposure(
    voices[0],
    plan.outStartMs + result.envelopes[STEM.vocals].endMs * plan.outgoingRate,
    plan.outStartMs + plan.durationMs * plan.outgoingRate,
  );
  const duration = Math.max(
    Math.ceil(6000 / (beat * 4)) * beat * 4,
    Math.round(plan.durationMs / (beat * 8)) * beat * 4,
  );
  const outStartMs = plan.outStartMs + (plan.durationMs - duration) * plan.outgoingRate;
  // 缩短仅限仍在可靠拍网内的乐句，不能悄悄改成原速桥接
  if (
    lostTail > 1500 &&
    duration < plan.durationMs &&
    outStartMs + beat * 4 * plan.outgoingRate <= profiles[0].gridEndMs! + profiles[0].periodMs!
  ) {
    result = arrangeVocalHandoff(
      arrangeAutoMix({ ...plan, outStartMs, durationMs: duration }, profiles[0], profiles[1]),
      voices[0],
      voices[1],
      beat,
    );
  }
  const vocalLossMs = measureAutoMixVocalLoss(result, voices);
  if (vocalLossMs.some((loss) => loss > 1000)) return { vocalLossMs };
  return { plan: result, vocalLossMs };
};

/**
 * 累计实际增益丢失的人声，包括选点之前已检测到的唱句
 * @param plan - 将执行的声部包络
 * @param voices - 两路人声证据，下一曲应覆盖全部候选入口
 * @returns 两路按声部强度加权的主唱损失毫秒数
 */
export const measureAutoMixVocalLoss = (
  plan: AutoMixArrangement,
  voices: VocalActivity[],
): number[] =>
  voices.map((activity, side) => {
    const cue = side ? plan.inStartMs : plan.outStartMs;
    const rate = side ? 1 : plan.outgoingRate;
    const span = plan.envelopes[STEM.vocals + (side ? INCOMING : 0)];
    return activity.weights.reduce((sum, weight, index) => {
      const sourceAt = activity.startMs + index * 100 + 50;
      const time = (sourceAt - cue) / rate;
      if (!side && time < 0) return sum;
      if (side && time >= plan.durationMs) return sum;
      // 下一曲入口之前已检测到的唱句也计入损失，不能通过后移入口逃避检查
      const phase = Math.max(0, Math.min(1, (time - span.startMs) / (span.endMs - span.startMs)));
      const gain = side ? Math.sin((phase * Math.PI) / 2) : Math.cos((phase * Math.PI) / 2);
      return sum + weight * (1 - gain * gain) * 100;
    }, 0);
  });
