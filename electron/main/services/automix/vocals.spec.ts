import { describe, expect, it } from "vitest";
import type { AutoMixArrangement } from "@shared/types/automix";
import { arrangeVocalHandoff, measureVocalActivity, vocalExposure } from "./vocals";

const plan: AutoMixArrangement = {
  outStartMs: 20_000,
  inStartMs: 0,
  durationMs: 8000,
  outgoingRate: 1,
  strategy: "phrase",
  levelRatio: 1,
  envelopes: Array.from({ length: 8 }, () => ({ startMs: 2000, endMs: 6000 })),
};

/**
 * 构造具有相同原曲电平的人声活动证据
 * @param vocals - 每百毫秒的人声电平
 * @returns 由音频电平测得的人声权重
 */
const createActivity = (vocals: number[]) =>
  measureVocalActivity({ startMs: 0, levels: vocals.map(() => 0.2) }, vocals, 0);

describe("音频主导的人声交接", () => {
  it("缺少歌词仍能在尾句与下一首首句之间交接，背景编排保持不变", () => {
    const outgoing = createActivity(
      Array.from({ length: 280 }, (_, i) => (i >= 200 && i < 230 ? 0.15 : 0)),
    );
    const incoming = createActivity(Array.from({ length: 80 }, (_, i) => (i >= 50 ? 0.15 : 0)));
    const result = arrangeVocalHandoff(plan, outgoing, incoming);
    expect(result.envelopes[2].startMs).toBeGreaterThanOrEqual(3000);
    expect(result.envelopes[6].endMs).toBeLessThanOrEqual(5000);
    for (const index of [0, 1, 3, 4, 5, 7])
      expect(result.envelopes[index]).toEqual(plan.envelopes[index]);
  });

  it("微弱垫唱允许少量取舍，持续主唱不能等同于前奏", () => {
    const activity = createActivity([...Array(30).fill(0.015), ...Array(30).fill(0.15)]);
    expect(vocalExposure(activity, 0, 3000)).toBeLessThan(30);
    expect(vocalExposure(activity, 3000, 6000)).toBeGreaterThan(2900);
  });

  it("低电平串音和单个瞬态不能制造虚假唱段", () => {
    const input = Array(100).fill(0.001);
    input[30] = 0.15;
    expect(vocalExposure(createActivity(input), 0, 10_000)).toBe(0);
  });

  it("双主唱冲突时允许少量取舍，不能把下一首首句延后压低数秒", () => {
    const outgoing = createActivity(Array(280).fill(0.15));
    const incoming = createActivity(Array(80).fill(0.1));
    const result = arrangeVocalHandoff(plan, outgoing, incoming);
    expect(vocalExposure(incoming, 0, result.envelopes[6].endMs)).toBeLessThanOrEqual(1500);
  });
});
