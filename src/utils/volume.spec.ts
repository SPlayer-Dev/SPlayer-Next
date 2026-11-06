import { describe, expect, it } from "vitest";
import { volumeGainToPosition, volumePositionToGain } from "./volume";

/** 把滑块位置对应的增益换算成 dB */
const toDb = (position: number): number => 20 * Math.log10(volumePositionToGain(position));

describe("音量曲线", () => {
  it("静音与满音量为端点", () => {
    expect(volumePositionToGain(0)).toBe(0);
    expect(volumeGainToPosition(0)).toBe(0);
    expect(volumePositionToGain(1)).toBe(1);
    expect(volumeGainToPosition(1)).toBe(1);
  });

  it("半程约 -10 dB，听感为满音量的一半", () => {
    expect(toDb(0.5)).toBeCloseTo(-10, 0);
    expect(toDb(0.8)).toBeCloseTo(-3.2, 1);
  });

  it("最低一档非常小声但可闻", () => {
    expect(toDb(0.05)).toBeCloseTo(-43, 0);
  });

  it("步进的浮点尾差不会在静音附近留下增益", () => {
    expect(volumePositionToGain(0.1 - 0.05 - 0.05)).toBe(0);
  });

  it("位置与增益互为逆映射", () => {
    for (const position of [0.01, 0.05, 0.2, 0.5, 0.77, 1]) {
      expect(volumeGainToPosition(volumePositionToGain(position))).toBeCloseTo(position, 9);
    }
  });
});
