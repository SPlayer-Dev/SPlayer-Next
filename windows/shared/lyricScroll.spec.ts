import { describe, expect, it } from "vitest";
import type { LyricLine } from "lyric-kit";
import {
  computeHorizontalScrollOffset,
  computeHorizontalScrollRange,
  computeLyricScrollOffset,
  computeSingingProgress,
  measureHorizontalScrollRange,
} from "./lyricScroll";

describe("歌词横向滚动范围", () => {
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

describe("歌词横向匀速滚动时序", () => {
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

/**
 * 构造逐字歌词行，每词两个字符、时长 1 秒、首尾相接
 * @param count - 词数
 * @returns 歌词行
 */
const makeTimedLine = (count: number): LyricLine => {
  const words = Array.from({ length: count }, (_slot, index) => ({
    word: "ab",
    startTime: index * 1000,
    endTime: (index + 1) * 1000,
  }));
  return {
    words,
    translatedLyric: "",
    romanLyric: "",
    startTime: 0,
    endTime: count * 1000,
    isBG: false,
    isDuet: false,
  };
};

describe("按演唱位置滚动", () => {
  const line = makeTimedLine(4);

  it("演唱进度按字数在词间连续插值", () => {
    expect(computeSingingProgress(line, -100)).toBe(0);
    expect(computeSingingProgress(line, 500)).toBe(0.125);
    expect(computeSingingProgress(line, 2000)).toBe(0.5);
    expect(computeSingingProgress(line, 9000)).toBe(1);
  });

  it("演唱位置越过容器中点前不滚动，之后跟随并在末尾停住", () => {
    const options = {
      activatedAtMs: 0,
      timingLine: line,
      containerWidth: 100,
      range: { startOffset: 10, distance: 100 },
    };
    expect(computeLyricScrollOffset({ ...options, currentMs: 1000 })).toBe(10);
    expect(computeLyricScrollOffset({ ...options, currentMs: 2000 })).toBe(-40);
    expect(computeLyricScrollOffset({ ...options, currentMs: 4000 })).toBe(-90);
  });

  it("没有逐字时间时退回匀速滚动", () => {
    const plain: LyricLine = {
      ...line,
      words: [{ word: "abcdefgh", startTime: 0, endTime: 0 }],
    };
    expect(
      computeLyricScrollOffset({
        currentMs: 0,
        activatedAtMs: 0,
        timingLine: plain,
        containerWidth: 100,
        range: { startOffset: 0, distance: 100 },
      }),
    ).toBe(0);
  });
});
