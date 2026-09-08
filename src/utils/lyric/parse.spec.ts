import { describe, expect, it } from "vitest";
import { bestExternalIndex, detectFormat, parseLyric } from "./parse";
import { parseQRC } from "./parseQRC";

describe("lyric parse", () => {
  it("根据内容识别常见歌词格式", () => {
    expect(detectFormat("[00:01.00]歌词")).toBe("lrc");
    expect(detectFormat("1\n00:00:01,000 --> 00:00:02,000\n歌词")).toBe("srt");
    expect(detectFormat('<tt xmlns="http://www.w3.org/ns/ttml"></tt>')).toBe("ttml");
    expect(detectFormat("[1000,500](1000,500,0)歌词")).toBe("yrc");
    expect(detectFormat("[1000,500]歌词(1000,500)")).toBe("qrc");
  });

  it("按照指定优先级选择外部歌词", () => {
    const lyrics = [{ format: "lrc" as const }, { format: "ttml" as const }];

    expect(bestExternalIndex(lyrics, ["ttml", "lrc"])).toBe(1);
    expect(bestExternalIndex([], ["ttml", "lrc"])).toBe(-1);
  });

  it("LRC 会忽略元数据、按时间排序并展开多时间戳", () => {
    const lines = parseLyric(
      { content: "[ar:歌手]\n[00:02.00]第二行\n[00:01.00][00:03.00]重复行" },
      "lrc",
    );

    expect(lines.map(({ startTime }) => startTime)).toEqual([1_000, 2_000, 3_000]);
    expect(lines.map(({ words }) => words.map(({ word }) => word).join(""))).toEqual([
      "重复行",
      "第二行",
      "重复行",
    ]);
  });

  it("在容差内配对翻译和音译，超过容差时不误配", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.20]你好\n[00:02.40]世界",
        translationFormat: "lrc",
        romaji: "[00:01.10]Harō\n[00:02.10]Wārudo",
        romajiFormat: "lrc",
      },
      "lrc",
    );

    expect(lines[0].translatedLyric).toBe("你好");
    expect(lines[1].translatedLyric).toBe("");
    expect(lines[0].romanLyric).toBe("Harō");
    expect(lines[1].romanLyric).toBe("Wārudo");
  });

  it("过滤无意义的翻译占位内容", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.00]//\n[00:02.00]作品的著作权由原作者所有",
        translationFormat: "lrc",
      },
      "lrc",
    );

    expect(lines.every(({ translatedLyric }) => translatedLyric === "")).toBe(true);
  });

  it("将空时间标签保留为结束上一行的空白时间节点", () => {
    const lines = parseLyric({ content: "[00:00.00]A\n[00:01.00]\n[00:02.00]B" }, "lrc");

    expect(lines).toHaveLength(2);
    expect(lines[0].endTime).toBe(1_000);
    expect(lines[1].startTime).toBe(2_000);
  });

  it("使用 ESLRC 末尾时间标签结束最后一个字", () => {
    const [line] = parseLyric({ content: "[00:00.00]<00:00.00>A<00:01.00>B<00:02.00>" }, "lrc");

    expect(line.words).toEqual([
      { startTime: 0, endTime: 1_000, word: "A" },
      { startTime: 1_000, endTime: 2_000, word: "B" },
    ]);
    expect(line.endTime).toBe(2_000);
  });

  it("QRC kana 将连续 1 占位拆成独立 token，并移除注音时间戳", () => {
    const lines = parseQRC(
      "[kana:11111こ(681,552)1どく]\n[0,10]坂(0,1)本(1,1)暁(2,1)良(3,1)孤(4,1)独(5,1)",
    );

    expect(lines[0].words.slice(0, 4).every((word) => !word.ruby)).toBe(true);
    expect(lines[0].words[4].ruby?.[0]?.word).toBe("こ");
    expect(lines[0].words[5].ruby?.[0]?.word).toBe("どく");
  });

  it("QRC kana 为全角数字和迭代符号消费注音 token", () => {
    const lines = parseQRC("[kana:1いち1ど1ひ1び]\n[0,10]１(0,1)度(1,1)日(2,1)々(3,1)");

    expect(lines[0].words.map((word) => word.ruby?.[0]?.word)).toEqual(["いち", "ど", "ひ", "び"]);
  });

  it("QRC kana 将同一时间块中的连续数字作为一个注音单元", () => {
    const lines = parseQRC("[kana:1さんじゅういっ1せ]\n[0,10]31(0,1)世(1,1)");

    expect(lines[0].words[0].ruby?.[0]?.word).toBe("さんじゅういっ");
    expect(lines[0].words[1].ruby?.[0]?.word).toBe("せ");
  });

  it("QRC 可关闭日语注音而不影响主体歌词", () => {
    const [line] = parseLyric({ content: "[kana:1ひかり]\n[0,10]光(0,10)" }, "qrc", "", {
      showQrcKana: false,
    });
    expect(line.words[0]?.ruby).toBeUndefined();
    expect(line.words[0]?.word).toBe("光");
  });
});
