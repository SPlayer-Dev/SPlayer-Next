import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import BottomSpectrum from "./BottomSpectrum.vue";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
}));
const visibility = ref<DocumentVisibilityState>("visible");
vi.mock("@vueuse/core", () => ({
  useDocumentVisibility: () => visibility,
  useRafFn: () => ({ resume: mocks.resume, pause: mocks.pause }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ isPlaying: true }) }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => ({ player: {} }) }));
vi.mock("@/services/fftCapture", () => ({
  acquireFft: mocks.acquire,
  releaseFft: mocks.release,
}));

describe("频谱窗口可见性", () => {
  it("窗口隐藏时停采集和绘制，恢复及卸载保持引用配对", async () => {
    const wrapper = mount(BottomSpectrum);
    try {
      expect(mocks.acquire).toHaveBeenCalledTimes(1);
      visibility.value = "hidden";
      await nextTick();
      expect(mocks.release).toHaveBeenCalledTimes(1);
      expect(mocks.pause).toHaveBeenCalledTimes(1);
      visibility.value = "visible";
      await nextTick();
      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(mocks.resume).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
