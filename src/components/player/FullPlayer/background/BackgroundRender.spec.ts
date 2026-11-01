import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import BackgroundRender from "./BackgroundRender.vue";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  renderer: {
    setAlbum: vi.fn().mockResolvedValue(undefined),
    setFPS: vi.fn(),
    setRenderScale: vi.fn(),
    setHasLyric: vi.fn(),
    setStaticMode: vi.fn(),
    setFlowSpeed: vi.fn(),
    setLowFreqVolume: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
    getElement: vi.fn(() => document.createElement("canvas")),
  },
}));

const visibility = ref<DocumentVisibilityState>("visible");
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vueuse/core")>()),
  useDocumentVisibility: () => visibility,
}));
vi.mock("@/services/fftCapture", () => ({
  acquireFft: mocks.acquire,
  releaseFft: mocks.release,
}));
vi.mock("@applemusic-like-lyrics/core", () => ({
  BackgroundRender: { new: () => mocks.renderer },
  MeshGradientRenderer: class {},
  IsolationRenderer: class {},
  PixiRenderer: class {},
}));

afterEach(() => {
  visibility.value = "visible";
  vi.clearAllMocks();
});

describe("背景渲染资源生命周期", () => {
  it("隐藏时停止绘制和 FFT，恢复可见后重新获取，卸载时配对释放", async () => {
    const wrapper = mount(BackgroundRender, { props: { playing: true, enableBeat: true } });
    try {
      expect(mocks.acquire).toHaveBeenCalledTimes(1);
      visibility.value = "hidden";
      await nextTick();
      expect(mocks.renderer.pause).toHaveBeenCalledOnce();
      expect(mocks.release).toHaveBeenCalledTimes(1);
      visibility.value = "visible";
      await nextTick();
      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(mocks.renderer.resume).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
