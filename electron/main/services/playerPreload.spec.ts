import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), cancel: vi.fn() }));
vi.mock("@main/services/engine", () => ({
  getPlayer: () => ({ prepareNext: mocks.prepare, cancelPrepared: mocks.cancel }),
}));
vi.mock("@main/services/songCache", () => ({
  pinPreload: vi.fn(),
  cancelPreload: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => false } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { info: vi.fn() } }));

describe("后台曲尾交接通知", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(true);
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
