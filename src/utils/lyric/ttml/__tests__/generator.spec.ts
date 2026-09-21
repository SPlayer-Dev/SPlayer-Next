import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportTTML, formatTime, parseTTML } from "../index";

const XML = readFileSync(join(import.meta.dirname, "fixtures", "complex-test-song.ttml"), "utf-8");
const RUBY_XML = readFileSync(
  join(import.meta.dirname, "fixtures", "ruby-test-song.ttml"),
  "utf-8",
);

describe("TTML 生成器核心功能测试", () => {
  it("formatTime 规范时间格式化（前导零对齐与小时进位）", () => {
    expect(formatTime(0)).toBe("00:00.000");
    expect(formatTime(10500)).toBe("00:10.500");
    expect(formatTime(65000)).toBe("01:05.000");
    expect(formatTime(3900000)).toBe("01:05:00.000");
  });

  it("支持原生 LyricResult 导出为标准 XML 并保证 Round-trip 往返解析一致性", () => {
    const splayerLyric = parseTTML(XML, { preferredLang: "zh-Hans-CN" });
    const generated = exportTTML(splayerLyric, {
      language: "zh-CN",
      translationLanguage: "zh-Hans",
    });

    // 命名空间与基础结构
    expect(generated).toContain('xmlns="http://www.w3.org/ns/ttml"');
    expect(generated).toContain('xml:lang="zh-CN"');
    expect(generated).toContain("xmlns:itunes");
    expect(generated).toContain("xmlns:amll");
    expect(generated).toContain("xmlns:ttm");
    expect(generated).toContain("xmlns:tts");
    expect(generated).toContain('itunes:key="L1"');
    expect(generated).toContain('itunes:songPart="Verse"');
    expect(generated).toContain('amll:obscene="true"');
    expect(generated).toContain('amll:empty-beat="5"');
    expect(generated).toContain("这是第一行歌词 (演唱者A)");

    // 往返解析验证
    const roundTrip = parseTTML(generated, { preferredLang: "zh-Hans" });
    expect(roundTrip.lines[0].id).toBe("L1");
    expect(roundTrip.lines[0].songPart).toBe("Verse");
    expect(roundTrip.lines[0].words[0].obscene).toBe(true);
    expect(roundTrip.lines[0].words[2].emptyBeat).toBe(5);
    expect(roundTrip.metadata.title).toContain("Complex Test Song");
  });

  it("支持行内翻译模式 (useSidecar: false)", () => {
    const splayerLyric = parseTTML(XML, { preferredLang: "zh-Hans-CN" });
    const inlineXml = exportTTML(splayerLyric, {
      useSidecar: false,
      translationLanguage: "zh-Hans",
    });

    expect(inlineXml).not.toContain("<iTunesMetadata");
    expect(inlineXml).toContain('ttm:role="x-translation"');
    expect(inlineXml).toContain("这是第一行歌词 (演唱者A)");

    const roundTrip = parseTTML(inlineXml, { preferredLang: "zh-Hans" });
    expect(roundTrip.lines[0].translatedLyric).toBe("这是第一行歌词 (演唱者A)");
  });

  it("正确序列化与往返解析 Ruby 振假名注音结构", () => {
    const rubyParsed = parseTTML(RUBY_XML);
    const generated = exportTTML(rubyParsed);

    expect(generated).toContain('tts:ruby="container"');
    expect(generated).toContain('tts:ruby="base"');
    expect(generated).toContain('tts:ruby="textContainer"');
    expect(generated).toContain('tts:ruby="text"');
    expect(generated).toContain("しょ");

    const roundTrip = parseTTML(generated);
    expect(roundTrip.lines[0].words[1].ruby?.[0].word).toBe("しょ");
  });
});
