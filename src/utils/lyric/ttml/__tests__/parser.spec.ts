import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseTTML } from "../index";
import type { LyricResult } from "@shared/types/lyrics";

const XML = readFileSync(join(import.meta.dirname, "fixtures", "complex-test-song.ttml"), "utf-8");
const RUBY_XML = readFileSync(
  join(import.meta.dirname, "fixtures", "ruby-test-song.ttml"),
  "utf-8",
);

describe("TTML 解析器核心功能测试", () => {
  let result: LyricResult;

  beforeAll(() => {
    result = parseTTML(XML, {
      preferredLang: "zh-Hans-CN",
      romanizationLanguage: "ja-Latn",
      extractMetadata: true,
    });
  });

  it("完整解析歌曲元数据与结构分段", () => {
    const meta = result.metadata;
    expect(meta.timingMode).toBe("Word");
    expect(meta.title).toEqual(["Complex Test Song", "複雑なテストソング"]);
    expect(meta.artist).toEqual(["Vocalist A (Taro)", "Vocalist B (Hanako)"]);
    expect(meta.isrc).toEqual(["JPXX02500001"]);
    expect(meta.songwriters).toEqual(["作曲者1号", "作曲者2号"]);
    expect(meta.authors).toContain("TestUser");

    // 平台 ID
    expect(meta.platformIds?.ncmMusicId).toContain("123456789");
    expect(meta.platformIds?.qqMusicId).toContain("987654321");
    expect(meta.platformIds?.spotifyId).toContain("abc123xyz");
    expect(meta.platformIds?.appleMusicId).toContain("999888777");

    // Agents 映射
    expect(meta.agents?.v1?.name).toBe("Vocalist A (Taro)");
    expect(meta.agents?.v1000?.name).toBe("Chorus Group");
  });

  it("正确响应 extractMetadata: false 选项", () => {
    const noMetaResult = parseTTML(XML, { extractMetadata: false });
    expect(noMetaResult.metadata).toEqual({});
    expect(noMetaResult.lines.length).toBeGreaterThan(0);
  });

  it("正确提取逐字歌词、Sidecar 翻译、音译对齐及词间扩展属性", () => {
    const l1 = result.lines.find((l) => l.id === "L1");
    expect(l1).toBeDefined();
    expect(l1?.songPart).toBe("Verse");
    expect(l1?.agentId).toBe("v1");
    expect(l1?.translatedLyric).toBe("这是第一行歌词 (演唱者A)");

    // 逐字与空格/空拍/脏标
    expect(l1?.words).toMatchObject([
      { word: "これ", obscene: true, romanWord: "Ko" },
      { word: "は ", endsWithSpace: true, romanWord: "re" },
      { word: "テスト", emptyBeat: 5, romanWord: "tesuto" },
    ]);
  });

  it("正确保留零起始时间（00:00.000）不被误覆盖", () => {
    const zeroXml = `<tt xmlns="http://www.w3.org/ns/ttml">
      <body>
        <div>
          <p begin="00:00.000" end="00:02.000">
            <span begin="00:00.200" end="00:01.800">Hello</span>
          </p>
        </div>
      </body>
    </tt>`;
    const parsed = parseTTML(zeroXml);
    expect(parsed.lines[0].startTime).toBe(0);
    expect(parsed.lines[0].endTime).toBe(2000);
  });

  it("正确处理背景伴唱独立拆分与声部对唱交替推导", () => {
    // 包含 3 条主行 + 1 条拆分出的背景行
    expect(result.lines).toHaveLength(4);

    const [l1, l2, l3, l3Bg] = result.lines;

    // L1 主唱 A (非对唱)
    expect(l1.isDuet).toBe(false);
    expect(l1.isBG).toBe(false);

    // L2 切换主唱 B (翻转为对唱)
    expect(l2.isDuet).toBe(true);
    expect(l2.isBG).toBe(false);

    // L3 Chorus 合唱 (保持非对唱)
    expect(l3.isDuet).toBe(false);
    expect(l3.isBG).toBe(false);

    // L3 伴唱行 (独立拆分)
    expect(l3Bg.isBG).toBe(true);
    expect(l3Bg.isDuet).toBe(false);
    expect(l3Bg.words[0].word).toBe("背景");
  });

  it("正确解析 Ruby 振假名注音结构", () => {
    const rubyResult = parseTTML(RUBY_XML);
    const l1 = rubyResult.lines[0];
    expect(l1.words).toHaveLength(3);

    expect(l1.words[0].word).toBe("これは");
    expect(l1.words[1].word).toBe("所");
    expect(l1.words[1].ruby).toMatchObject([{ word: "しょ", startTime: 27690, endTime: 27820 }]);
    expect(l1.words[2].word).toBe("詮");
    expect(l1.words[2].ruby).toMatchObject([
      { word: "せ", startTime: 27820, endTime: 27880 },
      { word: "ん", startTime: 27880, endTime: 27950 },
    ]);
  });

  it("两阶段多语言打分：偏好 zh-CN 时精准选中 zh-Hans 而非前置的 zh-Hant", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

    const parsed = parseTTML(xml, { preferredLang: "zh-CN" });
    expect(parsed.lines[0].translatedLyric).toBe("这是简体中文翻译");
  });

  it("防白屏容错：空内容或畸形 XML 正确抛出异常供上层捕获降级", () => {
    expect(() => parseTTML("")).toThrowError();
    expect(() => parseTTML("<invalid>xml")).toThrowError();
  });
});
