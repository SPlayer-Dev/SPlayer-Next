import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { LyricLine } from "@shared/types/lyrics";
import AMLLLyrics from "./AMLLLyrics.vue";

// 设置 store 初始化时会读取这些 IPC，测试环境下以空实现占位
const noopUnsubscribe = () => () => {};
Object.defineProperty(window, "api", {
  configurable: true,
  value: {
    config: { getAll: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    desktopLyric: { onConfigChange: noopUnsubscribe },
    dynamicIsland: { onConfigChange: noopUnsubscribe },
    player: { setFadeDuration: vi.fn().mockResolvedValue(undefined) },
    window: {
      onDesktopLyricVisibilityChange: noopUnsubscribe,
      onDynamicIslandVisibilityChange: noopUnsubscribe,
      onTaskbarLyricVisibilityChange: noopUnsubscribe,
      isDesktopLyricOpen: vi.fn().mockResolvedValue(false),
      isDynamicIslandOpen: vi.fn().mockResolvedValue(false),
      isTaskbarLyricOpen: vi.fn().mockResolvedValue(false),
    },
  },
});

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
 * 按 AMLL 的真实结构伪造行元素与尺寸
 *
 * AMLL 的行元素是内容层下绝对定位、带 inline translateY 的 div，
 * 与底部署名行同层；happy-dom 不做真实排版，故手动补上坐标。
 *
 * @param container - 歌词容器
 * @param lineCount - 行数
 * @param lineHeight - 单行高度
 * @param hiddenBefore - 该索引之前的行标记为已隐藏
 * @returns 行元素数量
 */
const stubAmllLayout = (
  container: HTMLElement,
  lineCount: number,
  lineHeight: number,
  hiddenBefore = 0,
): number => {
  Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });

  // 清掉组件可能已渲染的占位行，构造可控的行集合
  container.querySelectorAll("[data-test-line]").forEach((el) => el.remove());

  const layer = document.createElement("div");
  container.appendChild(layer);

  for (let i = 0; i < lineCount; i++) {
    const lineEl = document.createElement("div");
    lineEl.dataset.testLine = String(i);
    // 复刻 AMLL 的真实类名：哈希前缀 + 稳定后缀
    lineEl.className = "FmKaba_lyricLineWrapper";
    lineEl.style.position = "absolute";
    // AMLL 每帧写入内联 translateY，这里按行号复刻
    lineEl.style.transform = `translateY(${i * lineHeight}px)`;
    // 已隐藏行按 AMLL 的写法置为极小透明度
    if (i < hiddenBefore) lineEl.style.opacity = "0.0001";
    else lineEl.style.opacity = "1";
    Object.defineProperty(lineEl, "offsetHeight", { value: lineHeight, configurable: true });

    layer.appendChild(lineEl);
  }

  return container.querySelectorAll("[data-test-line]").length;
};

/**
 * 挂载 AMLL 歌词组件并伪造布局
 *
 * @param lineCount - 歌词行数
 * @param hiddenBefore - 该索引之前的行标记为已隐藏
 * @returns 容器、放行探针与卸载函数
 */
const setup = async (lineCount: number, hiddenBefore = 0) => {
  const wrapper = mount(AMLLLyrics, {
    props: { lyricLines: buildLyrics(lineCount), playing: true },
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  });

  // 等待组件挂载后的 nextTick / nextFrame 流程
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await wrapper.vm.$nextTick();

  // 组件为多根节点，wrapper.element 是外层占位 div，
  // 真正的歌词容器是内部的 .amll-lyrics-container
  const container = (wrapper.element as HTMLElement).querySelector(".amll-lyrics-container");
  if (!(container instanceof HTMLElement)) throw new Error("未找到 .amll-lyrics-container 容器");
  const measured = stubAmllLayout(container, lineCount, 100, hiddenBefore);

  let reachedProbe = false;
  container.addEventListener(
    "wheel",
    () => {
      reachedProbe = true;
    },
    { passive: true },
  );

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

describe("AMLLLyrics 滚动边界", () => {
  it("识别出 AMLL 结构的歌词行", async () => {
    const { measured, wrapper } = await setup(10);

    expect(measured).toBe(10);
    wrapper.unmount();
  });

  it("首行贴顶时向上滚动被拦截", async () => {
    const { dispatchWheel, wrapper } = await setup(10);

    expect(dispatchWheel(-120)).toBe(false);
    wrapper.unmount();
  });

  it("内容底部未贴底时向下滚动被放行", async () => {
    const { dispatchWheel, wrapper } = await setup(10);

    expect(dispatchWheel(120)).toBe(true);
    wrapper.unmount();
  });

  it("隐藏已播放行后不再放行滚入已隐藏区域", async () => {
    // 前 5 行已隐藏，可见内容从第 5 行开始且已贴顶，
    // 向上滚动应被拦截，不能滚进已隐藏行的空白区
    const { dispatchWheel, wrapper } = await setup(10, 5);

    expect(dispatchWheel(-120)).toBe(false);
    wrapper.unmount();
  });
});
