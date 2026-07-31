import { describe, expect, it } from "vitest";
import { getBassPulse, getFftBinRange, toAmllLowFreqVolume } from "./audioFeatures";

describe("audioFeatures", () => {
  it("只选择与低频范围相交的 FFT 频段", () => {
    const bass = getFftBinRange(80, 180);

    expect(bass.start).toBe(0);
    expect(bass.end).toBeGreaterThan(bass.start);
    expect(bass.end).toBeLessThan(128);
    expect(getFftBinRange(3_000, 4_000)).toEqual({ start: 0, end: 0 });
  });

  it("空频谱和低于阈值的频谱不产生脉冲", () => {
    expect(getBassPulse([[], []])).toBe(0);
    expect(getBassPulse([Array(128).fill(0.1), Array(128).fill(0.1)])).toBe(0);
  });

  it("强低频输入被限制在有效范围内", () => {
    expect(getBassPulse([Array(128).fill(1), Array(128).fill(1)])).toBe(1);
  });

  it("AMLL 低频音量映射会限制越界输入", () => {
    expect(toAmllLowFreqVolume(-1)).toBe(1);
    expect(toAmllLowFreqVolume(0.5)).toBeCloseTo(2.2);
    expect(toAmllLowFreqVolume(2)).toBeCloseTo(3.4);
  });
});
