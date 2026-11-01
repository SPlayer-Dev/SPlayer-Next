import { describe, expect, it } from "vitest";
import { parseLyric } from "lyric-kit";
import { buildDownloadLyric } from "./serialize";

describe("下载歌词格式兼容", () => {
  it("整秒歌词与外部翻译可下载，并在重新加载后保持对应", () => {
    const content = buildDownloadLyric(
      {
        content: "[ti:歌曲]\n[00:01]原词甲\n[00:03.250]原词乙",
        translation: "[00:01]译文甲\n[00:03.250]译文乙",
      },
      "lrc",
      "lrc",
    );
    expect(content).not.toBeNull();
    expect(content).not.toContain("[ti:");
    expect(
      parseLyric(content!).lines.map((line) => [line.startTime, line.translatedLyric]),
    ).toEqual([
      [1000, "译文甲"],
      [3250, "译文乙"],
    ]);
  });

  it.each(["lrc", "enhanced-lrc"] as const)(
    "%s 下载后保留只有罗马音的辅助行及毫秒起点",
    (target) => {
      const content = buildDownloadLyric(
        { content: "[00:01.001]你好", romaji: "[00:01.001]ni hao" },
        "lrc",
        target,
      );
      expect(content).not.toBeNull();
      expect(parseLyric(content!).lines[0]).toMatchObject({
        startTime: 1001,
        translatedLyric: "",
        romanLyric: "ni hao",
      });
    },
  );

  it("增强歌词下载后保留背景人声、词间空隙及最后一个字的结束时间", () => {
    const input = {
      content: "[00:01.001]<00:01.001>(Hello <00:01.307><00:01.555>World)<00:02.009>",
      translation: "[00:01.001](你好世界)",
      romaji: "[00:01.001](hello world)",
    };
    const content = buildDownloadLyric(input, "lrc", "enhanced-lrc");
    expect(content).not.toBeNull();
    expect(parseLyric(content!).lines).toEqual(parseLyric(input).lines);
  });

  it("已有 TTML 下载时保留原文及扩展元数据", () => {
    const original = `<tt xmlns="http://www.w3.org/ns/ttml"
      xmlns:amll="http://www.example.com/ns/amll"><head><metadata>
      <amll:meta key="musicName" value="歌曲"/></metadata></head><body><div>
      <p begin="1s" end="2s">歌词</p></div></body></tt>`;
    expect(buildDownloadLyric({ content: original }, "ttml", "ttml")).toBe(original);
  });

  it("无有效歌词时不生成下载文件", () => {
    expect(buildDownloadLyric({ content: "[ti:只有元数据]" }, "lrc", "lrc")).toBeNull();
  });
});
