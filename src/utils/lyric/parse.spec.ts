import { describe, expect, it } from "vitest";
import { bestExternalIndex, detectFormat, parseLyric } from "./parse";
import { parseTTML } from "./parseTTML";

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

  it("TTML 逐字 ruby 注音应提取到 LyricWord.ruby，汉字基底不含空字符串", () => {
    const ttml = [
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">',
      '<body><p begin="0" end="1000">',
      '<span begin="0" end="500">Dai</span> ',
      '<span begin="200" end="300"><tts:ruby base="行"><tts:ruby:textContainer><tts:ruby:text begin="200" end="250">い</tts:ruby:text></tts:ruby:textContainer></tts:ruby></span>',
      '<span begin="300" end="400"><tts:ruby base="く"><tts:ruby:textContainer><tts:ruby:text begin="300" end="400">こう</tts:ruby:text></tts:ruby:textContainer></tts:ruby></span>',
      "</p></body></tt>",
    ].join("");

    const lines = parseTTML(ttml);
    expect(lines).toHaveLength(1);
    const words = lines[0].words;

    // 不应有空的 word 字符串
    expect(words.some((w) => w.word === "")).toBe(false);

    // 应包含 Dai、行、く 三个非空单词（空格是 XML 源中的分隔符）
    const wordTexts = words.map((w) => w.word);
    expect(wordTexts).toEqual(["Dai", " ", "行", "く"]);

    // 汉字基底应正确获取时间戳（来自 ttml:text 的 begin/end）
    const xing = words.find((w) => w.word === "行");
    const ku = words.find((w) => w.word === "く");
    expect(xing).toMatchObject({ startTime: 200_000, endTime: 250_000 });
    expect(ku).toMatchObject({ startTime: 300_000, endTime: 400_000 });
  });

  it("TTML 简化格式（span tts:ruby container）应正确提取汉字基底时间戳并跳过注音文本", () => {
    // 模拟 AMLM 实际格式：<span tts:ruby="container"><span tts:ruby="base">行</span><span tts:ruby="textContainer">...</span></span>
    const ttml = [
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">',
      '<body><p begin="0" end="1000">',
      '<span begin="0" end="500">Dai</span> ',
      '<span tts:ruby="container"><span tts:ruby="base">行</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="200" end="250">い</span></span></span>',
      '<span tts:ruby="container"><span tts:ruby="base">く,</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="250" end="300">こう</span></span></span>',
      "</p></body></tt>",
    ].join("");

    const lines = parseTTML(ttml);
    expect(lines).toHaveLength(1);
    const words = lines[0].words;

    // 不应有空字符串单词
    expect(words.some((w) => w.word === "")).toBe(false);

    // 汉字基底应正确提取，注音文本不应混入
    const wordTexts = words.map((w) => w.word);
    expect(wordTexts).toEqual(["Dai", " ", "行", "く,"]);

    // 时间戳应来自 ttml:text 的 begin/end
    const xing = words.find((w) => w.word === "行");
    const ku = words.find((w) => w.word === "く,");
    expect(xing).toMatchObject({ startTime: 200_000, endTime: 250_000 });
    expect(ku).toMatchObject({ startTime: 250_000, endTime: 300_000 });
  });
});
