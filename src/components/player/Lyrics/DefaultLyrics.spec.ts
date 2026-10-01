import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { LyricLine } from "@shared/types/lyrics";
import DefaultLyrics from "./DefaultLyrics.vue";

/**
 * 构造若干行歌词
 *
 * @param count - 行数
 * @returns 歌词行数组
 */
const buildLyrics = (count: number): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      startTime: i * 1000,
      endTime: (i + 1) * 1000,
      words: [{ word: `第 ${i} 行歌词`, startTime: i * 1000, endTime: (i + 1) * 1000 }],
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    } as LyricLine);
  }
  return lines;
};

/**
 * 给容器与其行元素补上可测量的尺寸
 *
 * happy-dom 不做真实排版，`offsetHeight` 恒为 0、也没有引擎的 rAF 循环，因此按
 * 生产环境引擎的输出补齐：逐行写入内联 `translateY` 与行高，让测量逻辑能算出范围。
 *
 * @param container - 歌词容器
 * @param lineHeight - 单行高度
 * @returns 行元素数量
 */
const stubLayout = (container: HTMLElement, lineHeight: number): number => {
  Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });

  const lines = container.querySelectorAll<HTMLElement>(".lp-line:not(.lp-credit)");
  lines.forEach((lineEl, index) => {
    // lyric-dom 每帧写入内联 transform，这里按行号复刻
    lineEl.style.transform = `translateY(${index * lineHeight}px) scale(1)`;
    // 行由文字遮罩控制显隐，正常行取不透明
    lineEl.style.setProperty("--ba", "1");
    Object.defineProperty(lineEl, "offsetHeight", { value: lineHeight, configurable: true });
  });
  return lines.length;
};

/**
 * 挂载组件并伪造布局
 *
 * @param lineCount - 歌词行数
 * @returns 容器元素、放行探针与卸载函数
 */
const setup = (lineCount: number) => {
  const wrapper = mount(DefaultLyrics, {
    props: { lyricLines: buildLyrics(lineCount), playing: true },
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  });

  const container = wrapper.element as HTMLElement;
  const measured = stubLayout(container, 100);

  // 引擎无条件调用 preventDefault，无法据此判断是否被拦截；
  // 改在冒泡阶段放探针：被 stopImmediatePropagation 吞掉时探针不会执行。
  let reachedProbe = false;
  const probe = () => {
    reachedProbe = true;
  };
  container.addEventListener("wheel", probe, { passive: true });

  /**
   * 派发一次滚轮事件
   *
   * @param deltaY - 滚动增量
   * @returns 事件是否抵达探针（即被放行）
   */
  const dispatchWheel = (deltaY: number): boolean => {
    reachedProbe = false;
    container.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
    return reachedProbe;
  };

  return { container, measured, dispatchWheel, wrapper };
};

describe("DefaultLyrics 滚动边界", () => {
  it("渲染出歌词行并附加边界监听", () => {
    const { measured, wrapper } = setup(10);

    expect(measured).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("首行贴顶时向上滚动被拦截", () => {
    const { dispatchWheel, wrapper } = setup(10);

    // 首行 top 为 0 已顶到容器顶端，向上滚动应被吞掉
    expect(dispatchWheel(-120)).toBe(false);
    wrapper.unmount();
  });

  it("内容底部未贴底时向下滚动被放行", () => {
    const { dispatchWheel, wrapper } = setup(10);

    // 末行底部为 1000、容器高 300，仍有向下滚动余量
    expect(dispatchWheel(120)).toBe(true);
    wrapper.unmount();
  });

  it("内容不高于容器时上下滚动都被拦截", () => {
    const { dispatchWheel, wrapper } = setup(2);

    expect(dispatchWheel(-120)).toBe(false);
    expect(dispatchWheel(120)).toBe(false);
    wrapper.unmount();
  });

  it("持续滚动时不触发同步布局", () => {
    const { dispatchWheel, wrapper } = setup(60);

    // 首个事件会建立手势缓存（每行读一次行高），之后的每个事件都必须零布局开销，
    // 否则 60~120Hz 的滚轮会和引擎渲染循环互相打断造成掉帧
    dispatchWheel(120);

    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const styleSpy = vi.spyOn(window, "getComputedStyle");

    for (let i = 0; i < 20; i++) dispatchWheel(120);

    expect(rectSpy).not.toHaveBeenCalled();
    expect(styleSpy).not.toHaveBeenCalled();

    rectSpy.mockRestore();
    styleSpy.mockRestore();
    wrapper.unmount();
  });
});
