import { describe, expect, it } from "vitest";
import { resolveScrollRangeFromMetrics } from "./useLyricScrollBound";

describe("resolveScrollRangeFromMetrics", () => {
  it("首行已顶到容器顶部时不允许继续向上滚动", () => {
    // firstTop = 0：内容顶端贴住容器顶端，min 为 0 表示向上无可滚余量
    const range = resolveScrollRangeFromMetrics({
      firstTop: 0,
      lastBottom: 900,
      containerHeight: 400,
    });

    expect(range).toEqual({ min: 0, max: 500 });
  });

  it("末行已贴住容器底部时不允许继续向下滚动", () => {
    // lastBottom = containerHeight：内容底端贴住容器底端，max 为 0
    const range = resolveScrollRangeFromMetrics({
      firstTop: -500,
      lastBottom: 400,
      containerHeight: 400,
    });

    expect(range).toEqual({ min: -500, max: 0 });
  });

  it("内容高于容器时上下都有滚动余量", () => {
    // 上可滚 200、下可滚 80
    const range = resolveScrollRangeFromMetrics({
      firstTop: -200,
      lastBottom: 480,
      containerHeight: 400,
    });

    expect(range).toEqual({ min: -200, max: 80 });
  });

  it("内容不高于容器时锁死在原位", () => {
    const range = resolveScrollRangeFromMetrics({
      firstTop: 120,
      lastBottom: 260,
      containerHeight: 400,
    });

    expect(range).toEqual({ min: 0, max: 0 });
  });

  it("无有效可见行时不产生滚动区间", () => {
    // 隐藏行被剔除后首末位置重合，无法形成有效内容
    const range = resolveScrollRangeFromMetrics({
      firstTop: 150,
      lastBottom: 150,
      containerHeight: 400,
    });

    expect(range).toBeNull();
  });

  it("滚到区间端点时内容恰好贴住容器边缘", () => {
    const metrics = { firstTop: -200, lastBottom: 480, containerHeight: 400 };
    const { min, max } = resolveScrollRangeFromMetrics(metrics)!;

    // 滚到 min（向上滚到顶）：内容顶端贴住容器顶端
    expect(metrics.firstTop - min).toBe(0);
    // 滚到 max（向下滚到底）：内容底端贴住容器底端
    expect(metrics.lastBottom - max).toBe(metrics.containerHeight);
  });

  it("区间下界不小于上界，不会产生反向区间", () => {
    // 内容已被滚过边界时应收敛为不可滚动，等待引擎回弹
    const range = resolveScrollRangeFromMetrics({
      firstTop: -300,
      lastBottom: 600,
      containerHeight: 400,
    })!;

    expect(range.min).toBeLessThanOrEqual(range.max);
  });

  it("已播放行被隐藏后不再允许滚入已隐藏区域", () => {
    // 隐藏已播放行后测量只覆盖剩余可见行：首行贴顶，向上无可滚余量，
    // 只能向下滚动尚未看过的可见内容
    const { min, max } = resolveScrollRangeFromMetrics({
      firstTop: 0,
      lastBottom: 500,
      containerHeight: 400,
    })!;

    expect(min).toBe(0);
    expect(max).toBe(100);
  });
});
