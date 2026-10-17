import { describe, expect, it } from "vitest";
import { getMasonryRowSpan } from "./commentMasonry";

describe("瀑布流行数计算", () => {
  it("整除时得到精确行数", () => {
    expect(getMasonryRowSpan(30, 10, 0)).toBe(3);
  });

  it("小数向上取整", () => {
    expect(getMasonryRowSpan(31, 10, 0)).toBe(4);
  });

  it("零高度与极小高度都至少占一行", () => {
    expect(getMasonryRowSpan(0, 1, 12)).toBe(1);
    expect(getMasonryRowSpan(0.2, 1, 0)).toBe(1);
  });

  it("间距参与行数计算", () => {
    expect(getMasonryRowSpan(21, 10, 10)).toBe(2);
    expect(getMasonryRowSpan(21, 10, 0)).toBe(3);
  });
});
