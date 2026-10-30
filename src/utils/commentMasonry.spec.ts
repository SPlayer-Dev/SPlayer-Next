import { describe, expect, it } from "vitest";
import { layoutMasonry } from "./commentMasonry";

describe("瀑布流布局", () => {
  it("单列时纵向间距恒定", () => {
    const { positions, height } = layoutMasonry([100, 50, 80], 1, 300, 12);
    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 112 },
      { x: 0, y: 174 },
    ]);
    expect(positions[1].y - (positions[0].y + 100)).toBe(12);
    expect(positions[2].y - (positions[1].y + 50)).toBe(12);
    expect(height).toBe(254);
  });

  it("优先放入最矮的列", () => {
    const { positions } = layoutMasonry([100, 80, 40], 2, 200, 10);
    expect(positions[0]).toEqual({ x: 0, y: 0 });
    expect(positions[1]).toEqual({ x: 210, y: 0 });
    expect(positions[2]).toEqual({ x: 210, y: 90 });
  });

  it("容器高度不包含末尾间距", () => {
    expect(layoutMasonry([100], 1, 300, 12).height).toBe(100);
  });

  it("列数至少为一且空列表高度为零", () => {
    expect(layoutMasonry([10], 0, 300, 12).positions[0]).toEqual({ x: 0, y: 0 });
    expect(layoutMasonry([], 2, 300, 12)).toEqual({ positions: [], height: 0 });
  });
});
