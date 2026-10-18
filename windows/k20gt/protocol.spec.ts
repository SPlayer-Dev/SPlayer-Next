import { describe, expect, it } from "vitest";
import type { LyricLine } from "lyric-kit";
import type { NowPlayingPositionSync } from "@shared/types/nowPlaying";
import {
  encodeK20GTReport,
  prepareK20GTCaptions,
  selectK20GTCaption,
  splitK20GTText,
} from "@shared/utils/k20gt";

/**
 * 创建测试歌词行
 * @param text - 歌词原文
 * @param startTime - 开始毫秒
 * @param endTime - 结束毫秒
 * @returns 最小歌词行
 */
function line(text: string, startTime = 1000, endTime = 5000): LyricLine {
  return { startTime, endTime, words: [{ word: text }] } as LyricLine;
}

const anchor: NowPlayingPositionSync = {
  position: 1000,
  sendTimestamp: 10000,
  playing: true,
  state: "playing",
  speed: 1,
};

describe("K20 GT 协议与歌词选择", () => {
  it("与已验证的中文报文及退出报文逐字节一致", () => {
    const report = encodeK20GTReport("你好，世界");
    const bytes = new TextEncoder().encode("你好，世界");
    const expected = new Uint8Array(63);
    expected.set([0xaa, 1, 0, 19, 0, 2, 0x0b, 1, 5, 15, ...bytes]);
    expect(report).toEqual(expected);
    const clear = new Uint8Array(63);
    clear.set([0xaa, 1, 0, 4, 0, 2, 0x0b]);
    expect(encodeK20GTReport("")).toEqual(clear);
    expect(() => encodeK20GTReport("a".repeat(53))).toThrow();
  });

  it("在 52 字节边界保留完整中文和非 BMP 字符", () => {
    const text = `${"你".repeat(17)}😀abc`;
    const pages = splitK20GTText(text);
    expect(pages).toEqual(["你".repeat(17), "😀abc"]);
    expect(pages.join("")).toBe(text);
    expect(splitK20GTText("a".repeat(52))).toEqual(["a".repeat(52)]);
    expect(splitK20GTText("")).toEqual([]);
  });

  it("跟随播放时间分页，并处理暂停、倍速、偏移与向后跳转", () => {
    const captions = prepareK20GTCaptions([line("你".repeat(18))], "original", 10000);
    expect(selectK20GTCaption(captions, anchor, 0, 10000)).toBe("你".repeat(17));
    expect(selectK20GTCaption(captions, anchor, 0, 12000)).toBe("你");
    expect(selectK20GTCaption(captions, { ...anchor, speed: 2 }, 0, 11000)).toBe("你");
    expect(selectK20GTCaption(captions, anchor, 2000, 10000)).toBe("你");
    expect(
      selectK20GTCaption(captions, { ...anchor, playing: false, state: "paused" }, 0, 99999),
    ).toBe("你".repeat(17));
    expect(selectK20GTCaption(captions, { ...anchor, position: 500 }, 0, 10000)).toBe("");
  });

  it("忽略背景人声，间奏和结束时清屏，重叠行切到最新主行", () => {
    const captions = prepareK20GTCaptions(
      [
        line("前句", 1000, 4000),
        { ...line("背景", 2000, 4000), isBG: true },
        line("后句", 3000, 5000),
      ],
      "original",
      4500,
    );
    expect(selectK20GTCaption(captions, anchor, 0, 11000)).toBe("前句");
    expect(selectK20GTCaption(captions, anchor, 0, 12000)).toBe("后句");
    expect(selectK20GTCaption(captions, anchor, 0, 13500)).toBe("");
    for (const state of ["loading", "stopped", "idle"] as const) {
      expect(selectK20GTCaption(captions, { ...anchor, state }, 0, 10000)).toBe("");
    }
  });

  it("翻译与音译独立选择，缺失时回退原文，切歌后只使用新歌词", () => {
    const lyric = [{ ...line("原文"), translatedLyric: "译文", romanLyric: "音译" }];
    expect(prepareK20GTCaptions(lyric, "translation", 10000)[0].pages).toEqual(["译文"]);
    expect(prepareK20GTCaptions(lyric, "romanization", 10000)[0].pages).toEqual(["音译"]);
    expect(prepareK20GTCaptions([line("新曲")], "translation", 10000)[0].pages).toEqual(["新曲"]);
    expect(selectK20GTCaption([], anchor, 0, 10000)).toBe("");
  });
});
