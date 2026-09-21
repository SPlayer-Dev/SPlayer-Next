import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { exportTTML, TTMLGenerator, TTMLParser } from "../index";
import type { TTMLResult } from "../types";

const XML = readFileSync(join(import.meta.dirname, "fixtures", "complex-test-song.ttml"), "utf-8");

const RUBY_XML = readFileSync(
  join(import.meta.dirname, "fixtures", "ruby-test-song.ttml"),
  "utf-8",
);

describe("TTML 生成器测试套件", () => {
  let parsed: TTMLResult;

  beforeAll(() => {
    parsed = TTMLParser.parse(XML);
  });

  it("正确生成标准 TTML XML 字符串", () => {
    const generated = TTMLGenerator.generate(parsed);
    expect(generated).toContain("http://www.w3.org/ns/ttml");
    expect(generated).toContain("xmlns:itunes");
    expect(generated).toContain("xmlns:amll");
    expect(generated).toContain("xmlns:ttm");
    expect(generated).toContain("xmlns:tts");
    expect(generated).toContain('itunes:key="L1"');
    expect(generated).toContain('itunes:songPart="Verse"');
  });

  it("正确序列化 Ruby 注音结构", () => {
    const rubyParsed = TTMLParser.parse(RUBY_XML);
    const generated = exportTTML(rubyParsed);

    expect(generated).toContain('tts:ruby="container"');
    expect(generated).toContain('tts:ruby="base"');
    expect(generated).toContain('tts:ruby="textContainer"');
    expect(generated).toContain('tts:ruby="text"');
    expect(generated).toContain("しょ");
  });

  it("支持往返解析一致性 (Round-trip)", () => {
    const generated = exportTTML(parsed);
    const roundTripParsed = TTMLParser.parse(generated);

    expect(roundTripParsed.lines).toHaveLength(parsed.lines.length);
    expect(roundTripParsed.lines[0].id).toBe("L1");
    expect(roundTripParsed.lines[0].songPart).toBe("Verse");
    expect(roundTripParsed.metadata.title).toContain("Complex Test Song");
  });
});
