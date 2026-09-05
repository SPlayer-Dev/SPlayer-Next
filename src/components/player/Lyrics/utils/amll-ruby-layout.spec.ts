import type { LyricPlayer } from "@applemusic-like-lyrics/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeAmllRubyLayout } from "./amll-ruby-layout";

let resize: () => void;
let mutate: () => void;
let stop: (() => void) | undefined;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();

const createFixture = (scale = 1) => {
  const root = document.createElement("div");
  const line = document.createElement("div");
  line.className = "FmKaba_lyricMainLine";
  root.append(line);
  document.body.append(root);
  Object.defineProperty(root, "clientWidth", { value: 600, configurable: true });
  Object.defineProperty(line, "offsetWidth", { value: 600 });
  line.getBoundingClientRect = () => new DOMRect(0, 0, 600 * scale, 80 * scale);
  const updateMaskImageSync = vi.fn();
  const player = {
    getElement: () => root,
    currentLyricGroups: [{ mainLine: { getElement: () => line, updateMaskImageSync } }],
  } as unknown as LyricPlayer;
  let left = 0;

  const add = (text: string, width: number, rubyParts: [string, number][], top = 0) => {
    const wrapper = document.createElement("span");
    wrapper.className = "FmKaba_emphasizeWrapper";
    const word = document.createElement("span");
    word.className = "FmKaba_wordWithRuby";
    word.style.fontSize = "40px";
    const body = document.createElement("div");
    body.className = "FmKaba_wordBody";
    body.textContent = text;
    const bounds = { left, top, width };
    body.getBoundingClientRect = () =>
      new DOMRect(bounds.left * scale, bounds.top * scale, bounds.width * scale, 40 * scale);
    const ruby = document.createElement("div");
    ruby.className = "FmKaba_rubyWord";
    const parts = rubyParts.map(([content, partWidth], index) => {
      const element = document.createElement("span");
      element.textContent = content;
      element.dataset.startTime = String(index * 100);
      element.dataset.endTime = String((index + 1) * 100);
      const part = { element, width: partWidth };
      element.getBoundingClientRect = () => new DOMRect(0, 0, part.width * scale, 20 * scale);
      ruby.append(element);
      return part;
    });
    word.append(ruby, body);
    wrapper.append(word);
    line.append(wrapper);
    left += width;
    return { word, body, ruby, parts, bounds, wrapper };
  };
  return { root, line, player, add, updateMaskImageSync };
};

const offset = (ruby: HTMLElement): number =>
  Number.parseFloat(ruby.style.getPropertyValue("--amll-ruby-offset"));

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe("AMLL 连续汉字注音布局", () => {
  it("将物語的注音连续排列，并以整词中心居中", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    const last = fixture.add("語", 40, [["がたり", 60]]);
    stop = observeAmllRubyLayout(fixture.player);

    expect(offset(first.ruby)).toBe(-10);
    expect(offset(last.ruby)).toBe(0);
    const firstLeft = 20 + offset(first.ruby) - 20;
    const lastLeft = 60 + offset(last.ruby) - 30;
    expect(firstLeft + 40).toBe(lastLeft);
    expect((firstLeft + lastLeft + 60) / 2).toBe(40);
    expect(first.ruby.firstElementChild).toBe(first.parts[0].element);
    expect(last.parts[0].element.dataset.endTime).toBe("100");
    expect(first.ruby.style.visibility).toBe("");
  });

  it("最後未溢出时保留逐字居中", () => {
    const fixture = createFixture();
    const first = fixture.add("最", 40, [["さい", 40]]);
    const last = fixture.add("後", 40, [["ご", 20]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("按像素宽度处理汉字组及多个注音时间片段", () => {
    const fixture = createFixture();
    const first = fixture.add("天球", 80, [
      ["てん", 45],
      ["きゅう", 65],
    ]);
    const last = fixture.add("儀", 40, [["ぎ", 40]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 15]);
    expect(first.ruby.children).toHaveLength(2);
  });

  it("字符数较长但物理宽度未溢出时不合并", () => {
    const fixture = createFixture();
    const first = fixture.add("天球", 80, [["てんきゅう", 50]]);
    const last = fixture.add("儀", 40, [["ぎ", 20]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("溢出注音与相邻注音没有碰撞时不合并", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 20]]);
    const last = fixture.add("語", 40, [["がたり", 50]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("中间词溢出时左右关联汉字都参与合排", () => {
    const fixture = createFixture();
    const first = fixture.add("新", 40, [["しん", 40]]);
    const middle = fixture.add("物", 40, [["もの", 70]]);
    const last = fixture.add("語", 40, [["がたり", 40]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(middle.ruby), offset(last.ruby)]).toEqual([-15, 0, 15]);
  });

  it.each([" ", "、", "の"])("不跨过文本节点 %s 合并", (separator) => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    fixture.line.append(document.createTextNode(separator));
    const last = fixture.add("語", 40, [["がたり", 60]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it.each(["の", "、", "天球の", "A"])("非连续汉字 %s 断开合并", (text) => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    fixture.add(text, 40, [["かな", 60]]);
    const last = fixture.add("語", 40, [["がたり", 60]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("无注音汉字与空注音容器断开合并", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    fixture.add("語", 40, []);
    const last = fixture.add("天球", 80, [["てんきゅう", 100]]);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("不跨视觉换行合并", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    const last = fixture.add("語", 40, [["がたり", 60]], 60);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("剔除行缩放影响，并允许单词上浮动画产生的高度差", () => {
    const fixture = createFixture(0.75);
    const first = fixture.add("物", 40, [["もの", 40]]);
    const last = fixture.add("語", 40, [["がたり", 60]], -2);
    stop = observeAmllRubyLayout(fixture.player);
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([-10, 0]);
  });

  it("字体变化后解除合并，稳定布局不重复更新掩码或注册观察", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    const last = fixture.add("語", 40, [["がたり", 60]]);
    stop = observeAmllRubyLayout(fixture.player);
    const observations = observe.mock.calls.length;
    resize();
    expect(observe).toHaveBeenCalledTimes(observations);
    expect(fixture.updateMaskImageSync).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    last.parts[0].width = 30;
    resize();
    expect([offset(first.ruby), offset(last.ruby)]).toEqual([0, 0]);
  });

  it("长注音合排后仍有足够的掩码空间", () => {
    const fixture = createFixture();
    const first = fixture.add("天球", 80, [["てんきゅう", 240]]);
    const last = fixture.add("儀", 40, [["ぎ", 40]]);
    stop = observeAmllRubyLayout(fixture.player);
    for (const item of [first, last]) {
      const required = Math.abs(offset(item.ruby)) + (item.parts[0].width - item.bounds.width) / 2;
      expect(
        Number.parseFloat(item.word.style.getPropertyValue("--amll-ruby-padding")),
      ).toBeGreaterThan(required);
    }
  });

  it("歌词替换后释放旧节点的尺寸监听", () => {
    const fixture = createFixture();
    const old = fixture.add("語", 40, [["がたり", 60]]);
    stop = observeAmllRubyLayout(fixture.player);
    old.wrapper.remove();
    fixture.add("最", 40, [["さい", 40]]);
    mutate();
    expect(unobserve).toHaveBeenCalledWith(old.body);
    expect(unobserve).toHaveBeenCalledWith(old.parts[0].element);
  });

  it("初始隐藏时在恢复可见后计算布局", () => {
    const fixture = createFixture();
    const first = fixture.add("物", 40, [["もの", 40]]);
    fixture.add("語", 40, [["がたり", 60]]);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    stop = observeAmllRubyLayout(fixture.player);
    expect(first.ruby.style.getPropertyValue("--amll-ruby-offset")).toBe("");
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(offset(first.ruby)).toBe(-10);
    stop();
    stop = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
