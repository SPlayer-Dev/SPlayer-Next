import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const instances: MockPlayer[] = [];
  class MockPlayer {
    setCoverCacheDir = vi.fn();
    prepareNext = vi.fn().mockResolvedValue(true);
    cancelPrepared = vi.fn();
    stop = vi.fn();

    constructor() {
      instances.push(this);
    }
  }
  return { instances, MockPlayer, release: vi.fn(), pin: vi.fn(), invalidate: vi.fn() };
});

vi.mock("@main/utils/nativeLoader", () => ({
  loadNativeModule: () => ({ AudioPlayer: mocks.MockPlayer, initLogger: vi.fn() }),
}));
vi.mock("@main/utils/config", () => ({ getCoverCacheDir: () => "covers", isDev: true }));
vi.mock("@main/utils/logger", () => ({
  playerLog: { info: vi.fn(), warn: vi.fn() },
  nativeLogsDir: "logs",
}));
vi.mock("@main/store", () => ({ store: { get: () => true } }));
vi.mock("@main/services/songCache", () => ({
  cancelPreload: mocks.release,
  pinPreload: mocks.pin,
  invalidate: mocks.invalidate,
}));

describe("播放器重置时清理预载", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.instances.length = 0;
  });

  it("重置释放已就绪槽位的租约，并不再保留旧实例记录", async () => {
    const service = await import("./playerPreload");
    const engine = await import("./engine");
    await service.prepareNextTrack("next", "next.wav");
    const previous = engine.getPlayer();
    engine.resetPlayer();
    expect(previous.cancelPrepared).toHaveBeenCalledWith("next");
    expect(previous.stop).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith("next");
    service.cancelPreparedTrack();
    expect(previous.cancelPrepared).toHaveBeenCalledOnce();
    expect(engine.getPlayer()).not.toBe(previous);
  });

  it("原生取消失败仍释放租约并完成重置", async () => {
    const service = await import("./playerPreload");
    const engine = await import("./engine");
    await service.prepareNextTrack("next", "next.wav");
    mocks.instances[0]!.cancelPrepared.mockImplementationOnce(() => {
      throw new Error("设备丢失");
    });
    engine.resetPlayer();
    expect(mocks.release).toHaveBeenCalledWith("next");
    expect(mocks.instances[0]!.stop).toHaveBeenCalledOnce();
    service.cancelPreparedTrack();
    expect(mocks.instances[0]!.cancelPrepared).toHaveBeenCalledOnce();
  });

  it("重置后旧任务迟到返回不能占用或取消新实例的槽位", async () => {
    const service = await import("./playerPreload");
    const engine = await import("./engine");
    engine.getPlayer();
    let finish!: (ready: boolean) => void;
    mocks.instances[0]!.prepareNext.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.prepareNextTrack("old", "old.wav");
    engine.resetPlayer();
    expect(await service.prepareNextTrack("new", "new.wav")).toBe(true);
    finish(true);
    expect(await pending).toBe(false);
    expect(mocks.instances[1]!.cancelPrepared).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalledWith("new");
    service.cancelPreparedTrack();
    expect(mocks.instances[1]!.cancelPrepared).toHaveBeenCalledWith("new");
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
