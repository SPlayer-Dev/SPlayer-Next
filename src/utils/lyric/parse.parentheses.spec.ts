import { describe, expect, it } from "vitest";
import { parseLRC } from "./parseLRC";
import { parseKRC } from "./parseKRC";
import { parseQRC } from "./parseQRC";
import { parseYRC } from "./parseYRC";
import { parseTTML } from "./parseTTML";
import { parseLyS } from "./parseLyS";
import { parseASS } from "./parseASS";
import { parseSRT } from "./parseSRT";

describe("lyric parse inline parentheses background", () => {
  describe("LRC", () => {
    it("should parse LRC with inline parentheses background", () => {
      const lines = parseLRC("[00:00.00]主词(背景词)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景词");
    });

    it("should parse LRC with full-width parentheses", () => {
      const lines = parseLRC("[00:00.00]主词（背景词）", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景词");
    });

    it("should parse LRC with trailing parentheses", () => {
      const lines = parseLRC("[00:00.00]主词(和声)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip pure kana parentheses", () => {
      const lines = parseLRC("[00:00.00]汉字（あ）", true);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
      expect(lines[0].words[0].word).toBe("汉字（あ）");
    });

    it("should parse LRC without parentheses normally", () => {
      const lines = parseLRC("[00:00.00]主词", true);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
      expect(lines[0].words[0].word).toBe("主词");
    });

    it("should parse LRC with multiple parentheses", () => {
      const lines = parseLRC("[00:00.00]主词(背景) 和声(背景)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词 和声");
      expect(lines[1].words[0].word).toBe("背景");
    });
  });

  describe("KRC", () => {
    it("should parse KRC with inline parentheses background", () => {
      const lines = parseKRC("[00:00.00]<0,100>主词<100,100>(背景词)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景词");
    });

    it("should parse KRC with full-width parentheses", () => {
      const lines = parseKRC("[00:00.00]<0,100>主词<100,100>(背景词)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
    });

    it("should parse KRC with trailing parentheses", () => {
      const lines = parseKRC("[00:00.00]<0,100>主词<100,100>(和声)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip pure kana parentheses", () => {
      const lines = parseKRC("[00:00.00]<0,100>汉字<100,100>(あ)", true);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("QRC", () => {
    it("should parse QRC with inline parentheses background", () => {
      const lines = parseQRC("[1000,500]文字(1000,500)背景(1500,200)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("文字");
      expect(lines[1].words[0].word).toBe("背景");
    });

    it("should parse QRC with trailing parentheses", () => {
      const lines = parseQRC("[1000,500]文字(1000,500)(和声)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("文字");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip pure kana parentheses", () => {
      const lines = parseQRC("[1000,500]汉字(1000,500)(あ)", true);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("YRC", () => {
    it("should parse YRC with inline parentheses background", () => {
      const lines = parseYRC("[1000,500](1000,500,0)文字(1500,200,0)(背景)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("文字");
      expect(lines[1].words[0].word).toBe("背景");
    });

    it("should parse YRC with trailing parentheses", () => {
      const lines = parseYRC("[1000,500](1000,500,0)文字(1500,200,0)(和声)", true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("文字");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip pure kana parentheses", () => {
      const lines = parseYRC("[1000,500](1000,500,0)汉字(1500,200,0)(あ)", true);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("TTML", () => {
    it("should parse TTML with inline span background", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body>
    <div>
      <p begin="0" end="3000">
        <span begin="0" end="1000">主词</span>
        <span ttm:role="x-bg" begin="1000" end="3000">背景词</span>
      </p>
    </div>
  </body>
</tt>`;
      const lines = parseTTML(xml);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景词");
    });

    it("should parse TTML with full-width parentheses in text", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="0" end="3000">
        <span begin="0" end="1000">主词</span>
        <span begin="1000" end="3000">背景词</span>
      </p>
    </div>
  </body>
</tt>`;
      const lines = parseTTML(xml);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("LyS", () => {
    it("should parse LyS with inline parentheses background", () => {
      const text = "[0]主词(1000,200)背景(3000,200)";
      const lines = parseLyS(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景");
    });

    it("should parse LyS with trailing parentheses", () => {
      const text = "[0]主词(1000,200)(和声)";
      const lines = parseLyS(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip pure kana parentheses", () => {
      const text = "[0]汉字(1000,200)(あ)";
      const lines = parseLyS(text);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("ASS", () => {
    it("should parse ASS with inline parentheses background", () => {
      const text = `Dialogue:0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\kf1000}主词 {\kf1000}背景`;
      const lines = parseASS(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景");
    });

    it("should parse ASS with trailing parentheses", () => {
      const text = `Dialogue:0,0:00:00.00,0:00:03.00,Default,,0,0,0,,{\kf1000}主词 {\kf1000}(和声)`;
      const lines = parseASS(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("和声");
    });
  });

  describe("SRT", () => {
    it("should parse SRT with inline parentheses background", () => {
      const text = `1\n00:00:00,000 --> 00:00:03,000\n主词(背景词)`;
      const lines = parseSRT(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("背景词");
    });

    it("should parse SRT with trailing parentheses", () => {
      const text = `1\n00:00:00,000 --> 00:00:03,000\n主词(和声)`;
      const lines = parseSRT(text);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].words[0].word).toBe("和声");
    });

    it("should skip empty parentheses", () => {
      const text = `1\n00:00:00,000 --> 00:00:03,000\n主词()`; // 空括号应被跳过
      const lines = parseSRT(text);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
      expect(lines[0].words[0].word).toBe("主词()");
    });

    it("should skip pure kana parentheses", () => {
      const text = `1\n00:00:00,000 --> 00:00:03,000\n汉字(あ)`;
      const lines = parseSRT(text);
      expect(lines).toHaveLength(1);
      expect(lines[0].isBG).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle multiple lines with mixed parentheses", () => {
      const text = "[00:00.00]主词(背景)\n[00:01.00]歌词(和声)\n[00:02.00]文字";
      const lines = parseLRC(text, true);
      expect(lines).toHaveLength(3);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[2].isBG).toBe(false);
    });

    it("should handle parentheses in translation", () => {
      const text = "[00:00.00]主词(背景)\n[00:00.00]翻译(背景)";
      const lines = parseLRC(text, true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(false); // 翻译行不应该是背景
      expect(lines[0].words[0].word).toBe("主词");
      expect(lines[1].translatedLyric).toBe("翻译(背景)");
    });

    it("should handle no parentheses in input", () => {
      const text = "[00:00.00]主词\n[00:01.00]歌词";
      const lines = parseLRC(text, true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(false);
    });

    it("should handle parentheses at word boundaries", () => {
      const text = "[00:00.00]主词(背景)和声";
      const lines = parseLRC(text, true);
      expect(lines).toHaveLength(2);
      expect(lines[0].isBG).toBe(false);
      expect(lines[1].isBG).toBe(true);
      expect(lines[0].words[0].word).toBe("主词和声");
      expect(lines[1].words[0].word).toBe("背景");
    });
  });
});
