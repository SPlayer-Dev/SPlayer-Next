import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportTTML, parseTTML } from "../index";

const XML = readFileSync(join(import.meta.dirname, "fixtures", "complex-test-song.ttml"), "utf-8");
const RUBY_XML = readFileSync(
  join(import.meta.dirname, "fixtures", "ruby-test-song.ttml"),
  "utf-8",
);

describe("TTML 生成器核心功能测试", () => {
  it("支持原生 LyricResult 导出为标准 XML 并保证 Round-trip 往返解析一致性", () => {
    const splayerLyric = parseTTML(XML, { preferredLang: "zh-Hans-CN" });
    const generated = exportTTML(splayerLyric);

    // 命名空间与基础结构
    expect(generated).toContain('xmlns="http://www.w3.org/ns/ttml"');
    expect(generated).toContain("xmlns:itunes");
    expect(generated).toContain("xmlns:amll");
    expect(generated).toContain("xmlns:ttm");
    expect(generated).toContain("xmlns:tts");
    expect(generated).toContain('itunes:key="L1"');
    expect(generated).toContain('itunes:songPart="Verse"');
    expect(generated).toContain("这是第一行歌词 (演唱者A)");

    // 往返解析验证
    const roundTrip = parseTTML(generated, { preferredLang: "zh-Hans-CN" });
    expect(roundTrip.lines[0].id).toBe("L1");
    expect(roundTrip.lines[0].songPart).toBe("Verse");
    expect(roundTrip.metadata.title).toContain("Complex Test Song");
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
