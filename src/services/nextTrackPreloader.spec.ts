import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  settings: {
    player: {
      preloadNextTrack: true,
      songLevel: "hq",
      allowTrialPlay: false,
      transitionMode: "crossfade",
      transitionPreference: "standard",
    },
    system: {
      cache: { songCache: { enabled: true, cacheStreaming: true } },
      lyric: { enableOnlineTTMLLyric: false },
      localLyric: { enableLocalTTMLOverride: false, repoDir: "" },
    },
    lyric: {
      lyricSourcePreference: "auto",
      lyricSourceOrder: [],
      lyricFormatOrder: [],
      smartPreferOnline: false,
      preferPluginLyric: false,
    },
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
  },
  status: {
    currentTrack: { id: "current" },
    state: "playing",
    trackLoading: false,
    playIndex: 0,
    fmMode: false,
    shuffleMode: "off",
  },
  candidate: { track: { id: "next", source: "netease" } },
  resolve: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  lyric: vi.fn(),
  componentStatus: vi.fn(),
  componentSubscribe: vi.fn(),
  componentUnsubscribe: vi.fn(),
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
    mocks.resolve.mockReset();
    mocks.status = reactive({ ...mocks.status, state: "playing", trackLoading: false });
    mocks.settings = reactive(mocks.settings);
    mocks.settings.player.preloadNextTrack = true;
    mocks.settings.player.transitionMode = "crossfade";
    mocks.settings.player.transitionPreference = "standard";
    mocks.settings.system.cache.songCache = { enabled: true, cacheStreaming: true };
    mocks.candidate.track = { id: "next", source: "netease" };
    mocks.prepare.mockResolvedValue({ ready: true, autoMixStartMs: 20_000 });
    mocks.cancel.mockResolvedValue(undefined);
    mocks.componentStatus.mockResolvedValue({ state: "missing", models: [] });
    mocks.componentSubscribe.mockReturnValue(mocks.componentUnsubscribe);
    Object.assign(window, {
      api: {
        player: { prepareNext: mocks.prepare, cancelPrepared: mocks.cancel },
        automix: {
          onStatus: mocks.componentSubscribe,
          getStatus: mocks.componentStatus,
        },
      },
    });
  });

  afterEach(async () => {
    const preloader = await import("./nextTrackPreloader");
    preloader.disposeNextTrackPreload();
  });

  it("已下载歌曲直接准备原生预载槽位", async () => {
    mocks.resolve.mockResolvedValueOnce({
      source: "C:/downloads/next.flac",
      provider: "download",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/downloads/next.flac",
      undefined,
      "standard",
      undefined,
    );
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId).toEqual(
      expect.any(String),
    );
  });

  it("AutoMix 分析不可用时将 PCM 交给交叉过渡，在途检查不能反复消费和重建槽位", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.prepare.mockResolvedValue({ ready: true });
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track);
    expect(prepared?.preparedId).toBeTruthy();
    expect(prepared?.autoMixStartMs).toBeUndefined();
    expect(mocks.prepare.mock.calls[0][3]).toBe("standard");
    for (let i = 0; i < 3; i++) {
      expect(preloader.beginPreparedTransition(mocks.candidate.track as Track)).toBeNull();
      preloader.scheduleNextTrackPreload();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("AutoMix 提前准备完成时不提前变速，按显示时间在计划前两秒提交", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.prepare.mockResolvedValue({ ready: true, autoMixStartMs: 20_000 });
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const track = mocks.candidate.track as Track;
    expect(preloader.beginPreparedTransition(track, undefined, 10_000)).toBeNull();
    expect(preloader.beginPreparedTransition(track, undefined, 17_999)).toBeNull();
    expect(preloader.peekPreparedTrack(track)?.preparedId).toBeTruthy();
    expect(preloader.beginPreparedTransition(track, undefined, 18_000)?.preparedId).toBeTruthy();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("原生交接拒绝后保留音源等待正常切歌，后续进度检查不再创建 PCM", async () => {
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track)!;
    preloader.finishPreparedTransition(prepared.preparedId!, prepared);
    for (let i = 0; i < 3; i++) {
      preloader.scheduleNextTrackPreload();
      expect(preloader.beginPreparedTransition(mocks.candidate.track as Track)).toBeNull();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(prepared.preparedId);
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.source?.source).toBe(
      "next.flac",
    );
  });

  it("下载进度不作废 PCM，全部组件就绪后重新准备 AutoMix", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const service = await import("./automix");
    service.autoMixComponentStatus.value = {
      state: "missing",
      models: [
        { id: "beat", state: "ready", received: 1, total: 1 },
        { id: "runtime", state: "ready", received: 1, total: 1 },
      ],
    };
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    for (const received of [0, 50, 99]) {
      service.autoMixComponentStatus.value = {
        state: received === 99 ? "ready" : "downloading",
        models: [
          { id: "beat", state: "ready", received: 1, total: 1 },
          { id: "runtime", state: "ready", received: 1, total: 1 },
          {
            id: "demucs",
            state: received === 99 ? "ready" : "downloading",
            received,
            total: 99,
          },
        ],
      };
      preloader.scheduleNextTrackPreload();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("解析返回空值后允许同一候选重新预载", async () => {
    mocks.resolve.mockResolvedValueOnce(null).mockResolvedValueOnce({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeTruthy();
  });

  it("当前歌曲加载完成前不启动下一曲预载", async () => {
    mocks.status.state = "loading";
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.status.state = "playing";
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("停止播放会取消在途下载，迟到结果不能创建槽位，恢复后可重新预载", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      (_id: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValueOnce({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    mocks.status.state = "stopped";
    await flushPromises();
    const [id, signal] = cacheRequest.mock.calls[0]!;
    expect(signal.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    finish("C:/cache/next.bin");
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    mocks.status.state = "playing";
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("停止后迟到的解析结果不能恢复预载", async () => {
    let finish!: (source: unknown) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    mocks.status.state = "stopped";
    await flushPromises();
    finish({ source: "C:/cache/next.bin", provider: "cache", fromCache: true });
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("暂停保留在途预载，暂停后的结果仍可消费", async () => {
    let finish!: (source: unknown) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    mocks.status.state = "paused";
    await flushPromises();
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    finish({ source: "C:/cache/next.bin", provider: "cache", fromCache: true });
    await flushPromises();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeTruthy();
  });

  it("旧任务返回空值不会清理新任务的预载结果", async () => {
    let finish!: (source: null) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    preloader.invalidateNextTrackPreload();
    mocks.resolve.mockResolvedValueOnce({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const id = mocks.prepare.mock.calls[0]![0];
    finish(null);
    await flushPromises();
    expect(mocks.cancel).not.toHaveBeenCalledWith(id);
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId).toBe(id);
  });

  it("替换播放列表后等待当前曲加载完成，再准备下一首槽位", async () => {
    mocks.candidate.track.source = "local";
    mocks.resolve.mockResolvedValue({
      source: "C:/music/next.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");

    mocks.status.trackLoading = true;
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.status.trackLoading = false;
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
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
      undefined,
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
      undefined,
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
    expect(mocks.prepare).toHaveBeenCalledWith(
      id,
      "C:/cache/next.bin",
      undefined,
      "standard",
      undefined,
    );
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

  it.each(["关闭过渡", "修改倾向", "关闭预载"])("%s 时保留已提交交接的所有权", async (change) => {
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track)!;
    expect(prepared.preparedId).toBeTruthy();
    if (change === "关闭过渡") mocks.settings.player.transitionMode = "none";
    if (change === "修改倾向") mocks.settings.player.transitionPreference = "eager";
    if (change === "关闭预载") mocks.settings.player.preloadNextTrack = false;
    await flushPromises();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    preloader.finishPreparedTransition(prepared.preparedId!);
    await flushPromises();
    expect(mocks.cancel).toHaveBeenCalledWith(prepared.preparedId);
    expect(mocks.prepare).toHaveBeenCalledTimes(change === "关闭预载" ? 1 : 2);
  });

  it("迟到槽位通知不能取走当前备用槽位", async () => {
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(
      preloader.beginPreparedTransition(mocks.candidate.track as Track, "old-slot"),
    ).toBeNull();
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeTruthy();
  });
});
