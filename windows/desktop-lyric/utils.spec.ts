import { describe, expect, it } from "vitest";
import { computeHorizontalScrollRange } from "./utils";

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
});
