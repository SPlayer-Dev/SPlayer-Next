import { describe, expect, it } from "vitest";
import { computeHorizontalScrollRange, measureHorizontalScrollRange } from "./utils";

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
