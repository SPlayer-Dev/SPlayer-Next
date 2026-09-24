import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  settings: {
    player: {
      preloadNextTrack: true,
      transitionMode: "crossfade",
      transitionPreference: "standard",
      songLevel: "hq",
      allowTrialPlay: false,
    },
    system: { cache: { songCache: { enabled: true, cacheStreaming: true } } },
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
  },
  status: { currentTrack: { id: "current" }, playIndex: 0, fmMode: false, shuffleMode: "off" },
  candidate: { track: { id: "next", source: "netease" } },
  resolve: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  lyric: vi.fn(),
}));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: { id: "current" } }) }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => ({ activeServerId: "server" }) }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: [] }) }));
vi.mock("@/stores/queue", () => ({ queue: { value: [] } }));
vi.mock("@/core/player/candidate", () => ({ getNextTrackCandidate: () => mocks.candidate }));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/lyric/preload", () => ({
  preloadLyricForTrack: mocks.lyric,
  invalidatePreloadedLyric: vi.fn(),
}));

describe("下一曲真实预载", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.settings.player.preloadNextTrack = true;
    mocks.settings.system.cache.songCache = { enabled: true, cacheStreaming: true };
    mocks.candidate.track = { id: "next", source: "netease" };
    mocks.prepare.mockResolvedValue(true);
    mocks.cancel.mockResolvedValue(undefined);
    Object.assign(window, {
      api: { player: { prepareNext: mocks.prepare, cancelPrepared: mocks.cancel } },
    });
  });

  it.each([
    { enabled: false, cacheStreaming: false },
    { enabled: true, cacheStreaming: false },
    { enabled: false, cacheStreaming: true },
  ])("本地歌曲不依赖网络缓存开关：%j", async (cache) => {
    mocks.settings.system.cache.songCache = cache;
    mocks.candidate.track.source = "local";
    mocks.resolve.mockResolvedValue({
      source: "C:/music/next.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/music/next.flac",
      undefined,
      "standard",
    );
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
  });

  it("关闭缓存时本地 CUE 仍按片段起点准备", async () => {
    mocks.settings.system.cache.songCache = { enabled: false, cacheStreaming: false };
    Object.assign(mocks.candidate.track, {
      source: "local",
      cueAudioPath: "C:/music/album.flac",
      cueStartMs: 120000,
      cueEndMs: 240000,
    });
    mocks.resolve.mockResolvedValue({
      source: "C:/music/album.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/music/album.flac",
      120000,
      "standard",
    );
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
  });

  it("等待缓存完成后才准备原生槽位，并将缓存路径与代次交给切歌", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finish("C:/cache/next.bin");
    await flushPromises();
    const id = mocks.prepare.mock.calls[0]![0];
    expect(mocks.prepare).toHaveBeenCalledWith(id, "C:/cache/next.bin", undefined, "standard");
    const result = preloader.consumePreloadedTrack(mocks.candidate.track as Track);
    expect(result?.preparedId).toBe(id);
    expect(result?.source?.source).toBe("C:/cache/next.bin");
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("队列作废会取消缓存消费者，迟到下载不得打开原生槽位", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    preloader.invalidateNextTrackPreload();
    const [id, signal] = cacheRequest.mock.calls[0] as unknown as [string, AbortSignal];
    expect(signal.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    finish("C:/cache/next.bin");
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("未准备完就切歌时取消准备任务，不能消费未就绪资源", async () => {
    let finish!: (ready: boolean) => void;
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    mocks.prepare.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.prepare.mock.calls[0]![0]);
    finish(true);
    await flushPromises();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("关闭缓存后不再启动预载", async () => {
    mocks.settings.system.cache.songCache.enabled = false;
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("试听和缓存失败仍保留正常加载路径，不假报原生预载成功", async () => {
    mocks.resolve.mockResolvedValue({
      source: "https://music/trial",
      provider: "trial",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeUndefined();
  });
});
