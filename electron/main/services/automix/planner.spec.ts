import { describe, expect, it } from "vitest";
import type { AutoMixProfile } from "@shared/types/automix";
import { planAutoMix as createPlan, planAutoMixBridge } from "./planner";
import { arrangeAutoMix, arrangeAutoMixBridge } from "./arrangement";
import { measureBeatPeriod, pickBeatPeaks } from "./beats";
import { createAutoMixProfile } from "./features";

/**
 * 为有效音乐证据断言规划成功，便于逐项检查返回的执行参数
 * @param args - 待检查的首尾档案和边界
 * @returns 非空的有限混音计划
 */
const planAutoMix = (...args: Parameters<typeof createPlan>) => {
  const plan = createPlan(...args);
  expect(plan).not.toBeNull();
  return plan!;
};

/**
 * 生成具有已知节拍和源位置的规划证据
 * @param periodMs - 每拍时长
 * @returns 首尾二十秒的稳定节拍档案
 */
const profile = (periodMs = 500): AutoMixProfile => ({
  startMs: 0,
  endMs: 20_000,
  firstAudibleMs: 0,
  lastAudibleMs: 20_000,
  bodyEndMs: 20_000,
  gridStartMs: 0,
  gridEndMs: 20_000,
  levels: Array.from({ length: 200 }, () => 0.1),
  chroma: Array(2400).fill(0),
  boundaries: [],
  downbeats: Array.from(
    { length: Math.floor(20_000 / periodMs / 4) },
    (_, index) => index * periodMs * 4,
  ),
  periodMs,
  stability: 1,
});

describe("AutoMix 节拍规划", () => {
  it("三拍子的小节不能按四拍子强行编排", () => {
    const incoming = profile();
    incoming.downbeats = Array.from({ length: 13 }, (_, index) => index * 1500);
    expect(createPlan(profile(), incoming, 20_000)).toBeNull();
  });

  it("零散误检不会否定连续三个可靠小节，也不能制造新的重拍相位", () => {
    const incoming = profile();
    incoming.downbeats.push(350, 3100, 5850, 8700, 11_450, 14_100, 16_850, 19_500);
    const plan = planAutoMix(profile(), incoming, 20_000);
    expect(plan.inStartMs).toBe(0);
    incoming.downbeats = [350, 3100, 5850, 8700, 11_450, 14_100, 16_850, 19_500];
    expect(createPlan(profile(), incoming, 20_000)).toBeNull();
  });

  it("前段节奏不适合时允许跳到稍后的稳定乐句，不依赖歌词或扩大变速", () => {
    const incoming = {
      ...profile(),
      endMs: 40_000,
      gridStartMs: 12_000,
      gridEndMs: 40_000,
      downbeats: Array.from({ length: 14 }, (_, i) => 12_000 + i * 2000),
      levels: Array(400).fill(0.1),
      chroma: Array(4800).fill(0),
    };
    const plan = planAutoMix(profile(), incoming, 20_000);
    expect(plan.inStartMs).toBe(12_000);
    expect(plan.outgoingRate).toBe(1);
    expect(plan.inStartMs + plan.durationMs).toBeLessThanOrEqual(incoming.endMs);
    incoming.downbeats = [];
    expect(createPlan(profile(), incoming, 20_000)).toBeNull();
  });

  it("退出鼓后可以保留自由速度尾奏，鼓仍在可信网格内换手", () => {
    const outgoing = { ...profile(), gridEndMs: 12_000 };
    const plan = arrangeAutoMix(planAutoMix(outgoing, profile(), 20_000), outgoing, profile());
    expect(plan.outStartMs + plan.envelopes[0].endMs * plan.outgoingRate).toBeLessThanOrEqual(
      12_250,
    );
    expect(plan.outStartMs + plan.durationMs * plan.outgoingRate).toBe(20_000);
  });

  it("120 到 125 BPM 使用保音调的小幅倍率，并让两路拍点保持同步", () => {
    const plan = planAutoMix(profile(), profile(480), 20_000);
    expect(plan.outgoingRate).toBeCloseTo(500 / 480);
    expect(plan.durationMs / (4 * 480)).toBeCloseTo(Math.round(plan.durationMs / (4 * 480)));
    expect(profile().downbeats).toContain(plan.outStartMs);
    expect(plan.outStartMs + plan.durationMs * plan.outgoingRate).toBeLessThanOrEqual(20_000);
  });

  it("倍频节拍关系不会把整首音频拉到两倍速度", () => {
    const plan = planAutoMix(profile(500), profile(250), 20_000);
    expect(plan.outgoingRate).toBe(1);
  });

  it.each([0.92, 1.08])("边界倍率 %s 不因浮点减法被误拒", (rate) => {
    expect(planAutoMix(profile(), profile(500 / rate), 20_000).outgoingRate).toBeCloseTo(rate);
  });

  it.each([0.9195, 1.0807])("%s 越界时不对拍，不变速伪造对拍", (ideal) => {
    expect(createPlan(profile(), profile(500 / ideal), 20_000)).toBeNull();
  });

  it.each(["unstable", "far", "unknown"])("%s 证据不足时不对拍", (reason) => {
    const outgoing = profile();
    const incoming = profile(reason === "far" ? 700 : 500);
    if (reason === "unstable") outgoing.stability = 0.5;
    if (reason === "unknown") incoming.periodMs = null;
    expect(createPlan(outgoing, incoming, 20_000)).toBeNull();
  });

  it("CUE 空间不足时不对拍", () => {
    expect(createPlan(profile(), profile(), 5000)).toBeNull();
  });

  it("源窗口起点不会被当作整首歌的零点", () => {
    const outgoing = profile();
    outgoing.startMs += 120_000;
    outgoing.endMs += 120_000;
    outgoing.lastAudibleMs += 120_000;
    outgoing.bodyEndMs += 120_000;
    outgoing.gridStartMs! += 120_000;
    outgoing.gridEndMs! += 120_000;
    outgoing.downbeats = outgoing.downbeats.map((time) => time + 120_000);
    expect(planAutoMix(outgoing, profile(), 140_000).outStartMs).toBeGreaterThan(120_000);
  });

  it("和声冲突的候选会缩短旋律共存，而非一律选择最长重叠", () => {
    const outgoing = profile();
    outgoing.chroma = Array.from({ length: 2400 }, (_, i) => Number(i % 12 === 0));
    const compatible = { ...profile(), chroma: outgoing.chroma };
    const incompatible = {
      ...profile(),
      chroma: Array.from({ length: 2400 }, (_, i) => Number(i % 12 === 1)),
    };
    const phrase = planAutoMix(outgoing, compatible, 20_000);
    const handoff = arrangeAutoMix(
      planAutoMix(outgoing, incompatible, 20_000),
      outgoing,
      incompatible,
    );
    expect(phrase.durationMs).toBeGreaterThan(handoff.durationMs);
    expect(handoff.strategy).toBe("handoff");
    expect(handoff.envelopes[3]).toEqual(handoff.envelopes[7]);
    expect(handoff.envelopes[7].startMs).toBeGreaterThan(handoff.envelopes[4].endMs);
  });
});

describe("拍点模型后处理", () => {
  it("曲尾选择更晚的稳定段，不把较长的前段网格越过节奏变化外推", () => {
    const beats = [
      ...Array.from({ length: 40 }, (_, i) => i * 340),
      ...Array.from({ length: 16 }, (_, i) => 16_000 + i * 340),
      23_000,
      24_100,
    ];
    expect(measureBeatPeriod(beats).gridEndMs).toBe(13_260);
    const tail = measureBeatPeriod(beats, true);
    expect(tail.gridStartMs).toBe(16_000);
    expect(tail.gridEndMs).toBe(21_100);
    expect(tail.stability).toBe(1);
    expect(tail.periodMs).toBe(340);
  });

  it("合并相邻平台峰并保持二十毫秒帧时间，拒绝负分数", () => {
    const logits = new Float32Array(40).fill(-1);
    logits[10] = logits[11] = 2;
    logits[30] = 3;
    expect(pickBeatPeaks(logits)).toEqual([210, 600]);
  });

  it("保留不稳定节拍的低置信度，不把任意间距强制拟合成稳定网格", () => {
    expect(measureBeatPeriod(Array.from({ length: 40 }, (_, index) => index * 500))).toEqual({
      periodMs: 500,
      stability: 1,
      gridStartMs: 0,
      gridEndMs: 19_500,
    });
    expect(measureBeatPeriod([0, 400, 1000, 1350, 2000, 2400, 3000, 3350]).stability).toBeLessThan(
      0.85,
    );
  });

  it("前奏首个重拍的起音偏差不进入对拍相位", () => {
    const scores = new Float32Array(4000).fill(-1);
    for (let beat = 0; beat < 80; beat++) {
      // 首拍晚一帧，模拟前奏起音被模型检测得偏晚
      const frame = 25 + beat * 25 + (beat === 0 ? 1 : 0);
      scores[frame * 2] = 1;
      if (beat % 4 === 0) scores[frame * 2 + 1] = 1;
    }
    const profile = createAutoMixProfile(
      {
        startSeconds: 0,
        endSeconds: 40,
        firstAudibleSeconds: 0,
        lastAudibleSeconds: 40,
        levels: new Float32Array(400).fill(0.1),
        chroma: new Float32Array(4800),
      },
      scores,
    );
    expect(profile.downbeats[0]).toBeCloseTo(500, -1);
    expect(profile.downbeats[1]).toBeCloseTo(2500, -1);
  });

  it.each([124, 183])("%s BPM 的二十毫秒帧误差不破坏周期估计和稳定性", (bpm) => {
    const beats = Array.from(
      { length: 50 },
      (_, index) => Math.round((index * 60000) / bpm / 20) * 20,
    );
    const measured = measureBeatPeriod(beats);
    expect(measured.stability).toBe(1);
    expect(60000 / measured.periodMs!).toBeCloseTo(bpm, 0);
  });
});

describe("AutoMix 原速桥接", () => {
  it("拍速差超出变速范围时不变速，按小节定长并在下一曲重拍上短暂换手", () => {
    const outgoing = profile(500);
    const incoming = profile(420);
    expect(createPlan(outgoing, incoming, 20_000)).toBeNull();
    const plan = planAutoMixBridge(outgoing, incoming, 20_000)!;
    expect(plan).toMatchObject({ outgoingRate: 1, durationMs: 8400, strategy: "bridge" });
    expect(plan.outStartMs + plan.durationMs).toBeLessThanOrEqual(20_000);
    const { envelopes } = arrangeAutoMixBridge(plan, incoming);
    const swap = (envelopes[0].startMs + envelopes[0].endMs) / 2;
    expect(incoming.downbeats).toContain(swap + plan.inStartMs);
    for (const index of [0, 1, 4, 5])
      expect(envelopes[index].endMs - envelopes[index].startMs).toBe(250);
  });

  it("前奏过短、速度相差过大或不可信时不安排桥接", () => {
    const short = profile(420);
    short.endMs = 3000;
    expect(planAutoMixBridge(profile(500), short, 20_000)).toBeNull();
    expect(planAutoMixBridge(profile(500), profile(350), 20_000)).toBeNull();
    const unstable = profile(420);
    unstable.stability = 0.5;
    expect(planAutoMixBridge(profile(500), unstable, 20_000)).toBeNull();
  });
});
