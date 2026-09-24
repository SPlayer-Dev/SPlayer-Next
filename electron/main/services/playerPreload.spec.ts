import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), cancel: vi.fn(), analyze: vi.fn() }));
vi.mock("@main/services/engine", () => ({
  getPlayer: () => ({
    prepareNext: mocks.prepare,
    cancelPrepared: mocks.cancel,
    analyzeTail: mocks.analyze,
  }),
}));
vi.mock("@main/services/songCache", () => ({
  pinPreload: vi.fn(),
  cancelPreload: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => false } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { info: vi.fn(), warn: vi.fn() } }));

describe("后台曲尾交接通知", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(true);
    mocks.analyze.mockResolvedValue(25.25);
  });

  it.each([
    ["conservative", 1, 5500, false],
    ["conservative", 1, 4500, true],
    ["standard", 1, 8500, false],
    ["eager", 1, 8500, true],
    ["eager", 2, 17000, true],
    ["eager", 0.5, 4500, true],
  ] as const)("%s 档以 %sx 的墙钟时间通知交接", async (preference, speed, remaining, expected) => {
    const service = await import("./playerPreload");
    await service.prepareNextTrack("next", "next.wav", 0, preference);
    expect(service.takeTransitionReady(remaining, speed)).toBe(expected ? "next" : null);
  });

  it("以有效结尾通知交接，同一首只分析一次", async () => {
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 40000);
    await service.prepareNextTrack("next", "next.wav", 0, "standard");
    await flushPromises();
    expect(mocks.analyze).toHaveBeenCalledWith(0, 40);
    expect(service.getTransitionEndMs(40000)).toBe(25250);
    expect(service.takeTransitionReady(service.getTransitionEndMs(40000) - 20000)).toBe("next");
    await service.prepareNextTrack("another", "another.wav", 0, "standard");
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(service.getTransitionEndMs(40000, 30000)).toBe(31500);
    expect(service.getTransitionEndMs(40000, 30000, 2)).toBe(33000);
    expect(service.getTransitionEndMs(40000, 30000, 0.5)).toBe(31500);
  });

  it("切歌后丢弃尚未完成的尾部判定", async () => {
    let finish!: (end: number) => void;
    mocks.analyze.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 40000);
    await service.prepareNextTrack("next", "next.wav", 0, "standard");
    service.setCurrentTransitionRange(50000, 90000);
    finish(25.25);
    await flushPromises();
    expect(service.getTransitionEndMs(90000)).toBe(90000);
  });

  it("未启用交叉或分析失败时使用原始结尾", async () => {
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 40000);
    await service.prepareNextTrack("next", "next.wav");
    expect(mocks.analyze).not.toHaveBeenCalled();
    mocks.analyze.mockRejectedValue(new Error("decode failed"));
    await service.prepareNextTrack("another", "another.wav", 0, "standard");
    await flushPromises();
    expect(service.getTransitionEndMs(40000)).toBe(40000);
  });

  it("关闭歌曲缓存也允许本地文件进入备用槽位", async () => {
    const service = await import("./playerPreload");
    expect(await service.prepareNextTrack("local", "C:/music/album.flac", 120000)).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith("local", "C:/music/album.flac", 120);
    expect(service.takeTransitionReady(5000)).toBe("local");
  });

  it("就绪槽位在曲尾只通知一次，回退进度后可再次通知", async () => {
    const service = await import("./playerPreload");
    await service.prepareNextTrack("next", "next.wav");
    expect(service.takeTransitionReady(8000)).toBeNull();
    expect(service.takeTransitionReady(5900)).toBe("next");
    expect(service.takeTransitionReady(5700)).toBeNull();
    expect(service.takeTransitionReady(5600)).toBeNull();
    service.takeTransitionReady(9000);
    expect(service.takeTransitionReady(4000)).toBe("next");
    service.cancelPreparedTrack();
    expect(service.takeTransitionReady(3000)).toBeNull();
  });

  it("预载晚于曲尾到达时仍会通知，新槽位不受旧通知影响", async () => {
    const service = await import("./playerPreload");
    expect(service.takeTransitionReady(5500)).toBeNull();
    await service.prepareNextTrack("first", "first.wav");
    expect(service.takeTransitionReady(5000)).toBe("first");
    await service.prepareNextTrack("second", "second.wav");
    expect(service.takeTransitionReady(4500)).toBe("second");
    expect(service.takeTransitionReady(900)).toBeNull();
  });
});
