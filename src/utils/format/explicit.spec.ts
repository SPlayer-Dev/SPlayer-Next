import { describe, expect, it } from "vitest";
import { isExplicitLabel, stripExplicitLabel } from "@shared/utils/explicit";

describe("Explicit 版本标记识别", () => {
  it.each(["(Explicit)", " (Explicit)", "[Explicit]", "（Explicit）", "(explicit version)"])(
    "识别标记 %j",
    (label) => {
      expect(isExplicitLabel(label)).toBe(true);
    },
  );

  it.each([
    "",
    "Explicit",
    "(Clean)",
    "(Explicit Remix)",
    "Song (Explicit) [Live]",
    "Song [Explicit)",
    "Song [Explicit (Remix]",
  ])("不识别非尾部或不成对标记 %j", (label) => {
    expect(isExplicitLabel(label)).toBe(false);
  });

  it.each([
    ["Lose Yourself (Explicit)", "Lose Yourself"],
    ["Lose Yourself (Explicit Version)", "Lose Yourself"],
    [" 歌名 （Explicit） ", "歌名"],
    ["歌名", "歌名"],
  ])("移除 %j 的标记", (title, expected) => {
    expect(stripExplicitLabel(title)).toBe(expected);
  });
});
