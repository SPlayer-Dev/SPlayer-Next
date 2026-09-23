import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => {
  const track = { id: "next", source: "netease", title: "Next", artists: [], duration: 1000 };
  const media = {
    track: { ...track, id: "old" },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
  };
  return {
    track,
    transitionPreference: "standard" as "conservative" | "standard" | "eager",
    media,
    status: {
      currentTrack: { ...track, id: "old" },
      playIndex: 0,
      shuffleMode: "off",
      repeatMode: "off",
      fmMode: false,
      abLoop: { enable: false },
      duration: 10000,
      speed: 1,
      trackLoading: false,
      transitioning: false,
      isPlaying: true,
      state: "playing",
      currentSource: "old",
    },
    consume: vi.fn(),
    peek: vi.fn(),
    transition: vi.fn(),
    onTrackEnded: vi.fn(),
    resolve: vi.fn(),
    load: vi.fn(),
    stop: vi.fn(),
  };
});
vi.mock("./events", () => ({ handleEvent: vi.fn() }));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn(), onTrackEnded: mocks.onTrackEnded }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
    player: { transitionMode: "crossfade", transitionPreference: mocks.transitionPreference },
  }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({
    ...mocks.media,
    setTrack: (track: typeof mocks.track) => {
      mocks.media.track = track;
    },
  }),
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("@/stores/queue", () => ({
  queue: { value: [{ ...mocks.track, id: "old" }, mocks.track] },
  setQueue: vi.fn(),
  updateQueueTracks: vi.fn(),
}));
vi.mock("@/services/playback", () => ({
  setCurrentTime: vi.fn(),
  setDuration: vi.fn(),
  setPlaying: vi.fn(),
  setSeeking: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn() }));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/nextTrackPreloader", () => ({
  consumePreloadedTrack: mocks.consume,
  peekPreparedTrack: mocks.peek,
  disposeNextTrackPreload: vi.fn(),
  installNextTrackPreloadWatchers: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
}));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/utils/errors", () => ({
  handleError: vi.fn(),
  isSkippableError: (code: string) => code === "FILE_DECODE_ERROR",
}));
vi.mock("@/utils/preset/skipKeywords", () => ({ shouldSkipKeywordTrack: () => false }));
vi.mock("@/i18n", () => ({ default: { global: { t: (value: string) => value } } }));

describe("切歌消费真实预载", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.status.currentTrack = { ...mocks.track, id: "old" };
    mocks.status.playIndex = 0;
    mocks.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    mocks.stop.mockResolvedValue({ success: true });
    Object.assign(window, {
      api: { player: { load: mocks.load, stop: mocks.stop, transitionPrepared: mocks.transition } },
    });
  });

  it("准备完成的槽位直接交给 load，不能先 stop 清除它", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "prepared",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(
      "C:/cache/next.bin",
      expect.objectContaining({ preparedId: "prepared" }),
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("没有就绪槽位时保留正常停止、解析和加载流程", async () => {
    mocks.consume.mockReturnValue(null);
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith(
      "https://music/next",
      expect.objectContaining({ preparedId: undefined }),
    );
  });

  it("缓存音源失效后重新解析，并且不能把旧槽位代次带到重试中", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "stale",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: "FILE_DECODE_ERROR" });
    mocks.resolve.mockResolvedValue({
      source: "https://music/retry",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[1]).toEqual([
      "https://music/retry",
      expect.objectContaining({ preparedId: undefined }),
    ]);
  });
});

describe("交叉过渡的队列交接", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.status.currentTrack = { ...mocks.track, id: "old" };
    mocks.status.playIndex = 0;
    mocks.status.duration = 10000;
    mocks.status.isPlaying = true;
    mocks.status.trackLoading = false;
    mocks.status.repeatMode = "off";
    mocks.status.abLoop.enable = false;
    mocks.status.fmMode = false;
    mocks.transitionPreference = "standard";
    mocks.peek.mockReturnValue({
      preparedId: "next-slot",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    mocks.consume.mockReturnValueOnce({ preparedId: "next-slot" }).mockReturnValue(null);
    mocks.transition.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    Object.assign(window, {
      api: { player: { load: mocks.load, stop: mocks.stop, transitionPrepared: mocks.transition } },
    });
  });

  it("交接成功后更新队列和曲目，且不重新加载输出流", async () => {
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5000,
      "standard",
      expect.objectContaining({ meta: mocks.track }),
    );
    expect(mocks.status.playIndex).toBe(1);
    expect(mocks.media.track.id).toBe("next");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.onTrackEnded).toHaveBeenCalledWith(false);
  });

  it.each(["conservative", "eager"] as const)("%s 档向原生引擎传递交接倾向", async (preference) => {
    mocks.transitionPreference = preference;
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5000,
      preference,
      expect.objectContaining({ meta: mocks.track }),
    );
  });

  it("单曲循环时不提前交叉切换", async () => {
    mocks.status.repeatMode = "one";
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
