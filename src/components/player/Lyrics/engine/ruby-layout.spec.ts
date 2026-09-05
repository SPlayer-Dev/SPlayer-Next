import { beforeEach, describe, expect, it } from "vitest";
import { buildWordSpans, measureAndApplyWordMasks } from "./word-builder";
import type { LyricWord } from "@shared/types/lyrics";

beforeEach(() => document.body.replaceChildren());

const createLine = (texts: [string, string, number, number][], emphasize = false) => {
  const main = document.createElement("div");
  main.className = "lp-main";
  document.body.append(main);
  Object.defineProperty(main, "offsetWidth", { value: 600 });
  main.getBoundingClientRect = () => new DOMRect(0, 0, 600, 80);
  const words: LyricWord[] = texts.map(([word, ruby], index) => ({
    word,
    startTime: index * 2500,
    endTime: (index + 1) * 2500,
    ruby: ruby ? [{ word: ruby, startTime: index * 2500, endTime: (index + 1) * 2500 }] : [],
  }));
  const result = buildWordSpans(words, main, emphasize);
  let left = 0;
  const rubies = Array.from(main.querySelectorAll("ruby"));
  const dimensions = texts.filter(([, ruby]) => ruby);
  const rtWidths: number[] = [];
  rubies.forEach((ruby, index) => {
    const [, , width, rubyWidth] = dimensions[index];
    ruby.style.fontSize = "40px";
    const x = left;
    ruby.firstElementChild!.getBoundingClientRect = () => new DOMRect(x, 0, width, 40);
    rtWidths[index] = rubyWidth;
    ruby.lastElementChild!.getBoundingClientRect = () => new DOMRect(0, 0, rtWidths[index], 18);
    left += width;
  });
  const measure = () => measureAndApplyWordMasks([result.measurements], 0.5);
  const offsets = () =>
    rubies.map((ruby) =>
      Number.parseFloat(
        (ruby.lastElementChild as HTMLElement).style.getPropertyValue("--lp-ruby-offset"),
      ),
    );
  return { main, words, result, rubies, rtWidths, measure, offsets };
};

describe("physics 引擎 Ruby 合排", () => {
  it.each([false, true])("物語整体居中，并保留逐词掩码（强调效果：%s）", (emphasize) => {
    const fixture = createLine(
      [
        ["物", "もの", 40, 36],
        ["語", "がたり", 40, 54],
      ],
      emphasize,
    );
    fixture.measure();
    expect(fixture.offsets()).toEqual([-7, -2]);
    expect(
      fixture.result.measurements
        .filter(({ element }) => element.tagName === "RT")
        .map(({ word }) => word),
    ).toEqual(fixture.words);
    const rt = fixture.rubies[1].lastElementChild as HTMLElement;
    expect(rt.style.getPropertyValue("mask-position")).toContain("2420");
    expect(fixture.main.querySelectorAll("ruby")).toHaveLength(2);
  });

  it("最後保持逐字注音", () => {
    const fixture = createLine([
      ["最", "さい", 40, 36],
      ["後", "ご", 40, 18],
    ]);
    fixture.measure();
    expect(fixture.offsets()).toEqual([0, 0]);
  });

  it("整体注音的汉字组也参与合排", () => {
    const fixture = createLine([
      ["天球", "てんきゅうう", 80, 110],
      ["儀", "ぎ", 40, 36],
    ]);
    fixture.measure();
    expect(fixture.offsets()).toEqual([2, 15]);
  });

  it("字体变更后重新测量并恢复独立居中", () => {
    const fixture = createLine([
      ["物", "もの", 40, 36],
      ["語", "がたり", 40, 54],
    ]);
    fixture.measure();
    fixture.rtWidths[1] = 30;
    fixture.measure();
    expect(fixture.offsets()).toEqual([0, 0]);
  });

  it("空格隔开的汉字不合并", () => {
    const fixture = createLine([
      ["物", "もの", 40, 36],
      [" ", "", 0, 0],
      ["語", "がたり", 40, 54],
    ]);
    fixture.measure();
    expect(fixture.offsets()).toEqual([0, 0]);
  });
});
