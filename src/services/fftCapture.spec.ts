import { beforeEach, describe, expect, it, vi } from "vitest";

describe("fftCapture", () => {
  const setFftEnabled = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    setFftEnabled.mockReset();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { player: { setFftEnabled } },
    });
  });

  it("首个消费者开启 FFT，最后一个消费者释放时关闭", async () => {
    const { acquireFft, releaseFft } = await import("./fftCapture");

    acquireFft();
    acquireFft();
    releaseFft();

    expect(setFftEnabled).toHaveBeenCalledTimes(1);
    expect(setFftEnabled).toHaveBeenLastCalledWith(true);

    releaseFft();

    expect(setFftEnabled).toHaveBeenCalledTimes(2);
    expect(setFftEnabled).toHaveBeenLastCalledWith(false);
  });

  it("没有消费者时重复释放不会产生 IPC 调用", async () => {
    const { releaseFft } = await import("./fftCapture");

    releaseFft();

    expect(setFftEnabled).not.toHaveBeenCalled();
  });
});
