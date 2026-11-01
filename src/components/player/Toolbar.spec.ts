import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import persistedState from "pinia-plugin-persistedstate";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";
import { buildRegistry, dispatch } from "@/core/hotkey/registry";
import Toolbar from "./Toolbar.vue";
import SSlider from "@/components/ui/SSlider.vue";

vi.mock("@/stores/settings", async () => {
  const { defineStore } = await import("pinia");
  return {
    useSettingsStore: defineStore("settings", {
      state: () => ({
        appearance: { showQualitySwitch: false },
        isDesktopLyricOpen: false,
      }),
    }),
  };
});
vi.mock("@/core/player", () => ({ __v_isRef: false, setVolume: vi.fn() }));

const wrappers: VueWrapper[] = [];
const mountToolbar = () => {
  const pinia = createPinia().use(persistedState);
  const wrapper = mount(Toolbar, {
    global: {
      components: { SSlider },
      plugins: [
        pinia,
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
        SButton: { template: '<button><slot name="icon" /><slot /></button>' },
        SDropdownMenu: { template: "<div><slot /></div>" },
        EqualizerDialog: true,
        SpeedDialog: true,
        AutoCloseDialog: true,
        AbLoopDialog: true,
        FmModeDialog: true,
        QualityControl: true,
        QueuePopover: true,
        IconLucideVolumeX: true,
        IconLucideVolume1: true,
        IconLucideVolume2: true,
        IconLucideCaptions: true,
        IconLucideListMusic: true,
      },
    },
  });
  wrappers.push(wrapper);
  const status = useStatusStore(pinia);
  vi.mocked(player.setVolume).mockImplementation(async (gain) => {
    status.volume = gain;
  });
  buildRegistry();
  return { wrapper, status };
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});

describe("感知音量控制", () => {
  it("旧存档保持实际增益，滑块和百分比反向映射", () => {
    localStorage.setItem("status", JSON.stringify({ volume: 0.125 }));
    const { wrapper, status } = mountToolbar();
    expect(status.volume).toBe(0.125);
    expect(wrapper.getComponent(SSlider).props("modelValue")).toBeCloseTo(0.285739, 5);
    expect(wrapper.text()).toContain("29%");
    expect(player.setVolume).not.toHaveBeenCalled();
  });

  it("拖动到 50% 下发感知增益，重建组件后恢复相同实际音量", async () => {
    const { wrapper, status } = mountToolbar();
    const hitbox = wrapper.get(".s-slider-hitbox");
    Object.assign(hitbox.element, { setPointerCapture: vi.fn() });
    vi.spyOn(hitbox.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 15, 100));
    await hitbox.trigger("pointerdown", { pointerId: 1, clientY: 70 });
    expect(status.volume).toBeCloseTo(0.13553, 4);
    await hitbox.trigger("pointermove", { pointerId: 1, clientY: 50 });
    await hitbox.trigger("pointerup", { pointerId: 1, clientY: 50 });
    expect(player.setVolume).toHaveBeenLastCalledWith(expect.closeTo(0.316439, 5));
    expect(status.volume).toBeCloseTo(0.316439, 5);
    expect(JSON.parse(localStorage.getItem("status")!).volume).toBeCloseTo(0.316439, 5);
    wrapper.unmount();
    const restored = mountToolbar();
    expect(restored.status.volume).toBeCloseTo(0.316439, 5);
    expect(restored.wrapper.text()).toContain("50%");
  });

  it.each(["button", ".w-7"])("%s 上的滚轮与快捷键都按感知位置调整 5%%", async (target) => {
    const { wrapper, status } = mountToolbar();
    status.volume = 0.125;
    await nextTick();
    await wrapper.get(target).trigger("wheel", { deltaY: -100 });
    expect(status.volume).toBeCloseTo(0.16682, 4);
    expect(wrapper.text()).toContain("34%");
    expect(dispatch("player.volumeDown")).toBe(true);
    await nextTick();
    expect(status.volume).toBeCloseTo(0.125);
    expect(dispatch("player.volumeUp")).toBe(true);
    await nextTick();
    expect(status.volume).toBeCloseTo(0.16682, 4);
    await wrapper.get(target).trigger("wheel", { deltaY: 100 });
    expect(status.volume).toBeCloseTo(0.125);
  });

  it("静音后恢复原始增益，不重复应用曲线", async () => {
    const { wrapper, status } = mountToolbar();
    status.volume = 0.027;
    await nextTick();
    await wrapper.get("button").trigger("click");
    expect(status.volume).toBe(0);
    expect(wrapper.text()).toContain("0%");
    await wrapper.get("button").trigger("click");
    expect(status.volume).toBe(0.027);
    expect(wrapper.text()).toContain("11%");
  });

  it("滚轮和快捷键均限制在静音与满音量之间", async () => {
    const { wrapper, status } = mountToolbar();
    status.volume = 0;
    expect(dispatch("player.volumeUp")).toBe(true);
    expect(status.volume).toBeCloseTo(0.006923, 5);
    await nextTick();
    await wrapper.get("button").trigger("wheel", { deltaY: 100 });
    expect(status.volume).toBe(0);
    dispatch("player.volumeDown");
    expect(status.volume).toBe(0);
    await wrapper.get("button").trigger("wheel", { deltaY: 100 });
    expect(status.volume).toBe(0);
    status.volume = 1;
    dispatch("player.volumeUp");
    expect(status.volume).toBe(1);
    await nextTick();
    await wrapper.get("button").trigger("wheel", { deltaY: -100 });
    expect(status.volume).toBe(1);
  });
});
