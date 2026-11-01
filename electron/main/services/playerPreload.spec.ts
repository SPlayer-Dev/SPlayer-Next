import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { arrangeAutoMix } from "./automix/arrangement";
import type { AutoMixProfile } from "@shared/types/automix";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  cancel: vi.fn(),
  analyze: vi.fn(),
  automix: vi.fn(),
  enhance: vi.fn(),
  speed: vi.fn(),
  pitch: vi.fn(),
  stems: vi.fn(),
}));
vi.mock("@main/services/engine", () => ({
  onPlayerReset: vi.fn(),
  getPlayer: () => ({
    prepareNext: mocks.prepare,
    cancelPrepared: mocks.cancel,
    analyzeTail: mocks.analyze,
    getSpeed: mocks.speed,
    getPitch: mocks.pitch,
    installAutoMixStems: mocks.stems,
  }),
}));
vi.mock("@main/services/songCache", () => ({
  pinPreload: vi.fn(),
  cancelPreload: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => false } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./automix/analysisHost", () => ({ analyzeAutoMixTracks: mocks.automix }));
vi.mock("./automix/enhancement", () => ({ enhanceAutoMixPlan: mocks.enhance }));

/**
 * 构造可按四拍小节交接的二十秒档案
 * @returns 有效节拍与音源边界
 */
const profile = (): AutoMixProfile => ({
  startMs: 0,
  endMs: 20_000,
  firstAudibleMs: 0,
  lastAudibleMs: 20_000,
  bodyEndMs: 20_000,
  periodMs: 500,
  stability: 1,
  gridStartMs: 0,
  gridEndMs: 20_000,
  downbeats: Array.from({ length: 10 }, (_, i) => i * 2000),
  levels: Array(200).fill(0.1),
  chroma: Array(2400).fill(0),
  boundaries: [],
});

describe("后台曲尾交接通知", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(true);
    mocks.analyze.mockResolvedValue(25.25);
    mocks.automix.mockResolvedValue(null);
    mocks.enhance.mockReset().mockImplementation(async (plan, _tracks, profiles) => ({
      ...arrangeAutoMix(plan, profiles[0], profiles[1]),
      stems: {
        outgoing: { path: "current.stems", startMs: 0, frames: 882000 },
        incoming: { path: "next.stems", startMs: 0, frames: 882000 },
      },
    }));
    mocks.speed.mockReturnValue(1);
    mocks.pitch.mockReturnValue(0);
    mocks.stems.mockResolvedValue(true);
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

  it("用户使用倍速时不启动模型分析", async () => {
    mocks.speed.mockReturnValue(1.2);
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 40000, "current.wav");
    await service.prepareNextTrack("next", "next.wav", 0, undefined, { mode: "automix" });
    expect(mocks.automix).not.toHaveBeenCalled();
    expect(service.takeTransitionReady(5000, 1.2, 0)).toBe("next");
  });

  it.each(["缺少组件", "没有可用编排", "分轨失败"])(
    "%s 时保留原始入口并正常交接",
    async (reason) => {
      if (reason !== "缺少组件") mocks.automix.mockResolvedValue([profile(), profile()]);
      if (reason === "分轨失败") mocks.enhance.mockRejectedValue(new Error("inference failed"));
      else mocks.enhance.mockResolvedValue(undefined);
      const service = await import("./playerPreload");
      service.setCurrentTransitionRange(0, 20_000, "current.wav");
      expect(
        await service.prepareNextTrack("next", "next.wav", 1200, "standard", { mode: "automix" }),
      ).toBe(true);
      expect(service.getPreparedAutoMixPlan("next")).toBeUndefined();
      expect(mocks.prepare).toHaveBeenCalledWith("next", "next.wav", 1.2);
      expect(mocks.stems).not.toHaveBeenCalled();
      expect(service.takeTransitionReady(17_000)).toBeNull();
      expect(service.takeTransitionReady(5000)).toBe("next");
    },
  );

  it("按 AutoMix 计划通知交接，提交时复用分析并安装当前解码会话的声部", async () => {
    mocks.automix.mockResolvedValue([profile(), profile()]);
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 20_000, "current.wav");
    await service.prepareNextTrack("next", "next.wav", 0, "standard", {
      mode: "automix",
    });
    expect(service.getPreparedAutoMixPlan("next")).toBeDefined();
    expect(mocks.enhance).toHaveBeenCalledOnce();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(service.takeTransitionReady(19_000)).toBeNull();
    expect(service.takeTransitionReady(17_000)).toBe("next");
    expect(service.takeTransitionReady(16_000, 1.2)).toBeNull();
    expect(service.takeTransitionReady(16_000, 1, 2)).toBeNull();
    expect(mocks.stems).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith("next", "next.wav", 0, {
      path: "next.stems",
      startSeconds: 0,
      frames: 882000,
    });
    expect(await service.installPreparedAutoMixStems("next")).toBe(true);
    expect(await service.installPreparedAutoMixStems("next")).toBe(true);
    expect(mocks.stems).toHaveBeenLastCalledWith("next", "current.wav", {
      path: "current.stems",
      startSeconds: 0,
      frames: 882000,
    });
    let complete!: (value: boolean) => void;
    mocks.stems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const installing = service.installPreparedAutoMixStems("next");
    service.cancelPreparedTrack("next");
    complete(true);
    expect(await installing).toBe(false);
  });

  it("取消后迟到的模型结果不能复活下一曲槽位", async () => {
    let complete!: (value: null) => void;
    mocks.automix.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const service = await import("./playerPreload");
    service.setCurrentTransitionRange(0, 40000, "current.wav");
    const pending = service.prepareNextTrack("next", "next.wav", 0, undefined, { mode: "automix" });
    await flushPromises();
    service.cancelPreparedTrack("next");
    complete(null);
    expect(await pending).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(service.takeTransitionReady(5000)).toBeNull();
  });
});
