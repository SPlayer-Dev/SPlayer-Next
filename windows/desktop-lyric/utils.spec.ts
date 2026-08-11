import { describe, expect, it } from "vitest";
import {
  computeHorizontalScrollOffset,
  computeHorizontalScrollRange,
  measureHorizontalScrollRange,
} from "./utils";

describe("桌面歌词横向滚动范围", () => {
  it("左对齐文本从容器左侧滚动到内容末尾", () => {
    expect(computeHorizontalScrollRange(100, 160, 0)).toEqual({
      startOffset: 0,
      distance: 60,
    });
  });

  it("居中和右对齐文本会抵消初始布局偏移", () => {
    expect(computeHorizontalScrollRange(100, 160, -30)).toEqual({
      startOffset: 30,
      distance: 60,
    });
    expect(computeHorizontalScrollRange(100, 160, -60)).toEqual({
      startOffset: 60,
      distance: 60,
    });
  });

  it("遮罩内边距计入内容宽度且未溢出时不产生滚动", () => {
    expect(computeHorizontalScrollRange(100, 180, 0)).toEqual({
      startOffset: 0,
      distance: 80,
    });
    expect(computeHorizontalScrollRange(100, 100.5, 12)).toEqual({
      startOffset: 0,
      distance: 0,
    });
  });

  it("读取不受父级缩放影响的布局宽度", () => {
    const container = {
      clientWidth: 100,
      getBoundingClientRect: () => ({ width: 80 }),
    };
    const content = {
      scrollWidth: 160,
      offsetLeft: -30,
      getBoundingClientRect: () => ({ width: 128 }),
    };

    expect(content.getBoundingClientRect().width - container.getBoundingClientRect().width).toBe(
      48,
    );

    expect(measureHorizontalScrollRange(container, content)).toEqual({
      startOffset: 30,
      distance: 60,
    });
  });
});

describe("桌面歌词横向滚动时序", () => {
  it("短歌词不会在成为当前行时直接跳到末尾", () => {
    const options = {
      activatedAtMs: 1500,
      lineStartTime: 1000,
      lineEndTime: 1800,
      startOffset: 0,
      distance: 100,
    };

    expect(computeHorizontalScrollOffset({ ...options, currentMs: 1500 })).toBe(0);
    expect(computeHorizontalScrollOffset({ ...options, currentMs: 2000 })).toBeLessThan(0);
    expect(computeHorizontalScrollOffset({ ...options, currentMs: 2000 })).toBeGreaterThan(-100);
    expect(computeHorizontalScrollOffset({ ...options, currentMs: 2460 })).toBe(-100);
  });

  it("重叠歌词成为当前行后会从开头重新滚动", () => {
    const options = {
      lineStartTime: 1000,
      lineEndTime: 10000,
      startOffset: 30,
      distance: 120,
    };

    expect(
      computeHorizontalScrollOffset({ ...options, activatedAtMs: 6000, currentMs: 6000 }),
    ).toBe(30);
    expect(
      computeHorizontalScrollOffset({ ...options, activatedAtMs: 6000, currentMs: 8000 }),
    ).toBeLessThan(30);
  });

  it("正常时长歌词仍会在结束前滚动到末尾", () => {
    expect(
      computeHorizontalScrollOffset({
        currentMs: 9000,
        activatedAtMs: 1000,
        lineStartTime: 1000,
        lineEndTime: 11000,
        startOffset: 20,
        distance: 100,
      }),
    ).toBe(-80);
  });

  it("缺少有效结束时间时仍保留最短滚动过程", () => {
    const options = {
      activatedAtMs: 3000,
      lineStartTime: 3000,
      lineEndTime: 3000,
      startOffset: 0,
      distance: 60,
    };

    expect(computeHorizontalScrollOffset({ ...options, currentMs: 3000 })).toBe(0);
    expect(computeHorizontalScrollOffset({ ...options, currentMs: 3500 })).toBeLessThan(0);
    expect(computeHorizontalScrollOffset({ ...options, currentMs: 3960 })).toBe(-60);
  });
});
