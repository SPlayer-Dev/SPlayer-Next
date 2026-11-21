import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";

const isBorderless = ref(false);
const isFullscreen = ref(false);
const mocks = vi.hoisted(() => ({ isMac: true, zoom: 1 }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ reducedMotion: false, appearance: { fontFamily: "" } }),
}));
vi.mock("@/composables/useWindowControls", () => ({
  useWindowControls: () => ({ isBorderless, isFullscreen }),
}));
vi.mock("@/utils/config", () => ({
  /** 是否使用 macOS 原生标题栏 */
  get isMac() {
    return mocks.isMac;
  },
}));

beforeEach(() => {
  isBorderless.value = false;
  isFullscreen.value = false;
  mocks.isMac = true;
  mocks.zoom = 1;
  vi.stubGlobal("api", { window: { getZoomFactor: () => mocks.zoom } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

describe("原生标题栏布局空间", () => {
  it("独立保留标题栏高度，缩放时更新，全屏与无边框时释放", async () => {
    const wrapper = mount(App, { global: { stubs: { AppBackground: true, RouterView: true } } });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--s-native-titlebar-height")).toBe("32px");
    mocks.zoom = 0.5;
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(style.getPropertyValue("--s-native-titlebar-height")).toBe("64px");
    isFullscreen.value = true;
    await nextTick();
    expect(style.getPropertyValue("--s-native-titlebar-height")).toBe("0px");
    isFullscreen.value = false;
    await nextTick();
    expect(style.getPropertyValue("--s-native-titlebar-height")).toBe("64px");
    isBorderless.value = true;
    await nextTick();
    expect(style.getPropertyValue("--s-native-titlebar-height")).toBe("0px");
    wrapper.unmount();
  });

  it("其他平台不占用网页标题栏空间", () => {
    mocks.isMac = false;
    const wrapper = mount(App, { global: { stubs: { AppBackground: true, RouterView: true } } });
    expect(document.documentElement.style.getPropertyValue("--s-native-titlebar-height")).toBe(
      "0px",
    );
    wrapper.unmount();
  });
});
