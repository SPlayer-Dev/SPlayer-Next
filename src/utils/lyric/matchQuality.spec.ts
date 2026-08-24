import { describe, expect, it } from "vitest";

import { evaluateLyricMatch } from "./matchQuality";

const buildYrc = (texts: string[], timing: (index: number) => number): string =>
  texts
    .map((text, index) => {
      const start = timing(index);
      return `[${start},2000](${start},2000,0)${text}`;
    })
    .join("\n");

const buildQrc = (texts: string[], timing: (index: number) => number): string =>
  texts
    .map((text, index) => {
      const start = timing(index);
      return `[${start},2000]${text}(${start},2000)`;
    })
    .join("\n");

const lyrics = Array.from({ length: 12 }, (_, index) => `这是第${index + 1}句完整歌词`);

describe("evaluateLyricMatch", () => {
  it("接受正文相同且时间轴只有轻微误差的跨平台歌词", () => {
    const result = evaluateLyricMatch(
      { content: buildYrc(lyrics, (index) => index * 10_000) },
      "yrc",
      { content: buildQrc(lyrics, (index) => index * 10_000 + 500) },
      "qrc",
      120_000,
      121_000,
    );

    expect(result.status).toBe("accepted");
    expect(result.reason).toBe("matched");
  });

  it("拒绝 3:11 新版匹配到 3:53 旧版", () => {
    const result = evaluateLyricMatch(
      { content: buildYrc(lyrics, (index) => index * 10_000) },
      "yrc",
      { content: buildQrc(lyrics, (index) => index * 10_000) },
      "qrc",
      191_000,
      233_000,
    );

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("duration_mismatch");
  });

  it("拒绝同名但正文不同的歌词", () => {
    const otherLyrics = lyrics.map((_, index) => `完全不同的改编内容${index + 1}`);
    const result = evaluateLyricMatch(
      { content: buildYrc(lyrics, (index) => index * 10_000) },
      "yrc",
      { content: buildQrc(otherLyrics, (index) => index * 10_000) },
      "qrc",
      120_000,
      120_000,
    );

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("content_mismatch");
  });

  it("拒绝正文相同但演唱速度明显不同的版本", () => {
    const result = evaluateLyricMatch(
      { content: buildYrc(lyrics, (index) => index * 10_000) },
      "yrc",
      { content: buildQrc(lyrics, (index) => index * 11_000) },
      "qrc",
      120_000,
      120_000,
    );

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("timeline_mismatch");
  });

  it("允许相邻两行在另一平台合并为一行", () => {
    const merged = Array.from({ length: 6 }, (_, index) =>
      lyrics.slice(index * 2, index * 2 + 2).join(""),
    );
    const result = evaluateLyricMatch(
      { content: buildYrc(lyrics, (index) => index * 10_000) },
      "yrc",
      { content: buildQrc(merged, (index) => index * 20_000) },
      "qrc",
      120_000,
      120_000,
    );

    expect(result.status).toBe("accepted");
  });
});
