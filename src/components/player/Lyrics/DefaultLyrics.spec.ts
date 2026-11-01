import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "lyric-kit";

import { nextTick } from "vue";
import { useSettingsStore } from "@/stores/settings";
import DefaultLyrics from "./DefaultLyrics.vue";
import Lyrics from "./index.vue";

vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  const settings = reactive({
    lyric: {
      engine: "physics",
      alignment: "auto",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
    },
  });
  return { useSettingsStore: () => settings };
});

const lyricGlobals = {
  stubs: { AMLLLyrics: true, LyricCredit: true },
};

const makeLine = (word: string): LyricLine => ({
  startTime: 1000,
  endTime: 2000,
  words: [{ word, startTime: 1000, endTime: 2000 }],
  translatedLyric: "译文",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

describe("默认歌词引擎配置同步", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSettingsStore().lyric.alignment = "auto";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("应用歌词设置直接驱动默认引擎的水平对齐", async () => {
    const settings = useSettingsStore();
    const wrapper = mount(Lyrics, {
      props: { lyricLines: [makeLine("正文")] },
      global: lyricGlobals,
    });
    try {
      await flushPromises();
      const root = wrapper.get(".lp-root");
      expect(root.classes().filter((value) => value.startsWith("lp-align-"))).toEqual([]);
      settings.lyric.alignment = "center";
      await nextTick();
      expect(root.classes()).toContain("lp-align-center");
      settings.lyric.alignment = "right";
      await nextTick();
      expect(root.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });

  it("初始化和动态切换水平对齐保留原歌词 DOM，auto 恢复声部布局", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("正文")], alignment: "center" },
      global: lyricGlobals,
    });
    try {
      const original = wrapper.get(".lp-line").element;
      expect(wrapper.classes()).toContain("lp-align-center");
      for (const alignment of ["right", "left", "auto"] as const) {
        await wrapper.setProps({ alignment });
        expect(wrapper.get(".lp-line").element).toBe(original);
        const classes = wrapper.classes().filter((value) => value.startsWith("lp-align-"));
        expect(classes).toEqual(alignment === "auto" ? [] : [`lp-align-${alignment}`]);
      }
    } finally {
      wrapper.unmount();
    }
  });

  it("冻结时缓冲歌词更换，恢复后使用最新歌词和对齐配置", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("旧歌词")] },
      global: lyricGlobals,
    });
    try {
      wrapper.vm.freeze();
      await wrapper.setProps({ lyricLines: [makeLine("新歌词")], alignment: "right" });
      expect(wrapper.get(".lp-main").text()).toBe("旧歌词");
      wrapper.vm.resume();
      expect(wrapper.get(".lp-main").text()).toBe("新歌词");
      expect(wrapper.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });
});
