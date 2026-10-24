import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { createLyricPoster } from "./poster";

vi.mock("@/utils/color", () => ({ hexToRgb: () => "20, 20, 28" }));

/**
 * 捕获文字测量与绘制时的字体，模拟无封面的图片导出
 * @returns 字体加载桩、测量记录和绘制记录
 */
const setupCanvas = () => {
  const measured: Array<{ text: string; font: string; lang: string }> = [];
  const drawn: Array<{ text: string; font: string; lang: string }> = [];
  const load = vi.fn().mockResolvedValue([]);
  Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
  const context = {
    font: "",
    lang: "inherit",
    scale: vi.fn(),
    fillRect: vi.fn(),
    measureText: (text: string) => {
      measured.push({ text, font: context.font, lang: context.lang });
      return { width: text.length * (context.font.includes('"Wide"') ? 100 : 20) };
    },
    fillText: (text: string) => drawn.push({ text, font: context.font, lang: context.lang }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  return { load, measured, drawn };
};

const track = { title: "歌名", artists: [{ name: "歌手" }], source: "netease" } as Track;

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fonts");
});

describe("歌词海报字体", () => {
  it("沿用分语言、歌词和全局字体，并在测量与绘制时保持一致", async () => {
    const { measured, drawn } = setupCanvas();
    await createLyricPoster({
      track,
      fonts: {
        global: '"Global"',
        lyric: '"Lyrics"',
        japanese: '"Japanese"',
        chinese: '"Chinese"',
        latin: '"Latin"',
      },
      lines: [{ text: "君の歌", language: "ja", translation: "你的歌", romaji: "kimi no uta" }],
    });
    for (const [text, family] of [
      ["君の歌", "Japanese"],
      ["你的歌", "Chinese"],
      ["kimi no uta", "Latin"],
    ]) {
      const rendered = drawn.find((entry) => entry.text === text)!;
      expect(rendered.font).toContain(`"${family}", "Lyrics", "Global"`);
      expect(measured.some((entry) => entry.text === text && entry.font === rendered.font)).toBe(
        true,
      );
    }
    expect(drawn.find((entry) => entry.text === "歌名")?.font).toContain('"Global"');
  });

  it("只为原文歌词设置语言，翻译和音译使用默认语言", async () => {
    const { measured, drawn } = setupCanvas();
    await createLyricPoster({
      track,
      lines: [{ text: "骨と直", language: "ja", translation: "骨与直", romaji: "hone to choku" }],
    });

    expect(drawn.find((entry) => entry.text === "骨と直")?.lang).toBe("ja");
    expect(measured.some((entry) => entry.text === "骨と直" && entry.lang === "ja")).toBe(true);
    expect(drawn.find((entry) => entry.text === "骨与直")?.lang).toBe("inherit");
    expect(drawn.find((entry) => entry.text === "hone to choku")?.lang).toBe("inherit");
  });

  it("未设置歌词字体时使用全局字体", async () => {
    const { drawn } = setupCanvas();
    await createLyricPoster({
      track,
      fonts: { global: '"WenKai"' },
      lines: [{ text: "中文歌词" }],
    });
    expect(drawn.find((entry) => entry.text === "中文歌词")?.font).toMatch(/^bold 34px "WenKai",/);
  });

  it("修改歌词字体后重新计算长句换行，不沿用上次字体", async () => {
    const { drawn } = setupCanvas();
    const text = "这是用于验证不同字体换行的长句";
    await createLyricPoster({ track, fonts: { lyric: '"Wide"' }, lines: [{ text }] });
    const wideLines = drawn.filter((entry) => entry.font.startsWith('bold 34px "Wide"'));
    expect(wideLines.length).toBeGreaterThan(1);
    expect(wideLines.map((entry) => entry.text).join("")).toBe(text);
    drawn.length = 0;
    await createLyricPoster({ track, lines: [{ text }] });
    expect(drawn.find((entry) => entry.text === text)?.font).not.toContain('"Wide"');
  });

  it("字体加载完成前不测量或绘制文字", async () => {
    const { load, measured, drawn } = setupCanvas();
    const pending = Promise.withResolvers<FontFace[]>();
    load.mockReturnValue(pending.promise);
    const result = createLyricPoster({ track, lines: [{ text: "等待字体" }] });
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    expect(measured).toEqual([]);
    expect(drawn).toEqual([]);
    pending.resolve([]);
    expect((await result).type).toBe("image/png");
    expect(drawn.some((entry) => entry.text === "等待字体")).toBe(true);
  });
});
