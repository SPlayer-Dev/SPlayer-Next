import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseTTML, toAmllLyrics, toSPlayerLyricResult, TTMLParser } from "../index";
import type { SubLyricContent, TTMLResult } from "../types";

const XML = readFileSync(join(import.meta.dirname, "fixtures", "complex-test-song.ttml"), "utf-8");

const RUBY_XML = readFileSync(
  join(import.meta.dirname, "fixtures", "ruby-test-song.ttml"),
  "utf-8",
);

describe("TTML 解析器与转换器测试套件", () => {
  let parser: TTMLParser;
  let result: TTMLResult;

  beforeAll(() => {
    parser = new TTMLParser();
    result = parser.parse(XML);
  });

  const getLine = (id: string) => {
    const line = result.lines.find((l) => l.id === id);
    if (!line) throw new Error(`找不到 ID 为 ${id} 的歌词行`);
    return line;
  };

  const getTranslation = (item: { translations?: SubLyricContent[] }, lang: string) => {
    const trans = item.translations?.find((t) => t.language === lang);
    if (!trans) throw new Error(`未找到语言为 ${lang} 的翻译`);
    return trans;
  };

  const getRomanization = (item: { romanizations?: SubLyricContent[] }, lang: string) => {
    const roman = item.romanizations?.find((r) => r.language === lang);
    if (!roman) throw new Error(`未找到语言为 ${lang} 的音译`);
    return roman;
  };

  it("正确解析全局语言与计时模式", () => {
    expect(result.metadata.language).toBe("ja");
    expect(result.metadata.timingMode).toBe("Word");
    expect(result.metadata.title).toEqual(["Complex Test Song", "複雑なテストソング"]);
  });

  it("正确解析多音乐平台 ID", () => {
    expect(result.metadata.platformIds?.ncmMusicId).toContain("123456789");
    expect(result.metadata.platformIds?.qqMusicId).toContain("987654321");
    expect(result.metadata.platformIds?.spotifyId).toContain("abc123xyz");
    expect(result.metadata.platformIds?.appleMusicId).toContain("999888777");
  });

  it("正确解析歌手列表", () => {
    expect(result.metadata.artist).toHaveLength(2);
    expect(result.metadata.artist).toContain("Vocalist A (Taro)");
    expect(result.metadata.artist).toContain("Vocalist B (Hanako)");
  });

  it("构建演唱者 Agent 映射表", () => {
    expect(result.metadata.agents?.v1?.name).toBe("Vocalist A (Taro)");
    expect(result.metadata.agents?.v1000?.name).toBe("Chorus Group");
  });

  it("正确解析词曲作者列表", () => {
    expect(result.metadata.songwriters).toEqual(["作曲者1号", "作曲者2号"]);
  });

  it("正确解析 ISRC", () => {
    expect(result.metadata.isrc).toEqual(["JPXX02500001"]);
  });

  it("正确解析 L1 行的歌曲结构与演唱者", () => {
    const l1 = getLine("L1");
    expect(l1.songPart).toBe("Verse");
    expect(l1.agentId).toBe("v1");
  });

  it("从 Head 合并多语言翻译到 L1", () => {
    const l1 = getLine("L1");
    const transEn = getTranslation(l1, "en-US");
    const transZh = getTranslation(l1, "zh-Hans-CN");
    expect(transEn.text).toBe("This is the first line (Vocalist A)");
    expect(transZh.text).toBe("这是第一行歌词 (演唱者A)");
  });

  it("从 Head 合并逐字音译到 L1", () => {
    const l1 = getLine("L1");
    const roman = getRomanization(l1, "ja-Latn");
    expect(roman.words).toMatchObject([
      { text: "Ko", startTime: 10000, endTime: 10500, endsWithSpace: false },
      { text: "re", startTime: 10500, endTime: 10800, endsWithSpace: true },
      { text: "wa", startTime: 10800, endTime: 11000, endsWithSpace: true },
      { text: "tesuto", startTime: 11200, endTime: 11800, endsWithSpace: false },
    ]);
  });

  it("正确处理 L1 的词间空格与扩展属性", () => {
    const l1 = getLine("L1");
    expect(l1.words).toMatchObject([
      { text: "これ", obscene: true },
      { text: "は", endsWithSpace: true },
      { text: "テスト", emptyBeat: 5 },
    ]);
  });

  it("正确处理 L3 的背景人声与内联翻译", () => {
    const l3 = getLine("L3");
    expect(l3.songPart).toBe("Chorus");
    expect(l3.agentId).toBe("v1000");
    expect(l3.backgroundVocal).toBeDefined();

    const bg = l3.backgroundVocal!;
    expect(bg.text).toBe("背景");

    const transEn = getTranslation(bg, "en");
    expect(transEn.text).toBe("Background");

    const roman = getRomanization(bg, "ja-Latn");
    expect(roman.text).toBe("haikei");
  });

  it("正确解析所有歌词行", () => {
    expect(result.lines).toHaveLength(3);
    const lineIds = result.lines.map((l) => l.id);
    expect(lineIds).toEqual(["L1", "L2", "L3"]);
  });

  it("支持 toAmllLyrics 降级并正确处理对唱翻转与背景拆分", () => {
    const amll = toAmllLyrics(result, {
      translationLanguage: "zh-Hans-CN",
      romanizationLanguage: "ja-Latn",
    });

    // 包含 3 条主行 + 1 条拆分出的背景行，共 4 行
    expect(amll.lines).toHaveLength(4);

    // L1 为非对唱 (左)
    expect(amll.lines[0].isDuet).toBe(false);
    expect(amll.lines[0].translatedLyric).toBe("这是第一行歌词 (演唱者A)");

    // L2 切换演唱者，翻转为对唱 (右)
    expect(amll.lines[1].isDuet).toBe(true);

    // L3 为 Chorus Group，合唱保持非对唱 (居中)
    expect(amll.lines[2].isDuet).toBe(false);

    // L3 拆分出来的背景行 (isBG: true)
    expect(amll.lines[3].isBG).toBe(true);
    expect(amll.lines[3].isDuet).toBe(false);
  });

  it("正确解析 Ruby 注音结构 (ruby-test-song.ttml)", () => {
    const rubyResult = TTMLParser.parse(RUBY_XML);
    const l1 = rubyResult.lines[0];
    expect(l1.words).toHaveLength(3);

    expect(l1.words![0].text).toBe("これは");
    expect(l1.words![1].text).toBe("所");
    expect(l1.words![1].ruby).toMatchObject([{ text: "しょ", startTime: 27690, endTime: 27820 }]);
    expect(l1.words![2].text).toBe("詮");
    expect(l1.words![2].ruby).toMatchObject([
      { text: "せ", startTime: 27820, endTime: 27880 },
      { text: "ん", startTime: 27880, endTime: 27950 },
    ]);
  });

  it("两阶段多语言评分：即使 zh-Hant 位于首位，偏好 zh-CN 时依然精准选中 zh-Hans", () => {
    const ttmlWithHantFirst = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
  <head>
    <metadata>
      <iTunesMetadata>
        <translations>
          <translation xml:lang="zh-Hant">
            <text for="L1">這是繁體中文翻譯</text>
          </translation>
          <translation xml:lang="zh-Hans">
            <text for="L1">这是简体中文翻译</text>
          </translation>
        </translations>
      </iTunesMetadata>
    </metadata>
  </head>
  <body>
    <div>
      <p itunes:key="L1" begin="00:01.000" end="00:03.000">
        <span begin="00:01.000" end="00:03.000">Hello</span>
      </p>
    </div>
  </body>
</tt>`;

    const parsed = parseTTML(ttmlWithHantFirst, { preferredLang: "zh-CN" });
    expect(parsed.lines[0].translatedLyric).toBe("这是简体中文翻译");
  });

  it("toSPlayerLyricResult 完整保留 songPart、blockIndex、id、agentId 及 authors", () => {
    const splayerResult = toSPlayerLyricResult(result, { preferredLang: "zh-CN" });
    const l1 = splayerResult.lines[0];

    expect(l1.id).toBe("L1");
    expect(l1.agentId).toBe("v1");
    expect(l1.songPart).toBe("Verse");
    expect(l1.blockIndex).toBe(1);
    expect(l1.translatedLyric).toBe("这是第一行歌词 (演唱者A)");

    // 验证 authors 提取
    expect(splayerResult.metadata.authors).toContain("TestUser");
  });

  it("防白屏保护：畸形或空内容正确抛出异常以供外层捕获", () => {
    expect(() => TTMLParser.parse("")).toThrowError();
    expect(() => TTMLParser.parse("<invalid>xml")).toThrowError();
  });
});
