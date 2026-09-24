import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => {
  const track = { id: "next", source: "netease", title: "Next", artists: [], duration: 1000 };
  const media = {
    track: { ...track, id: "old" },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
    updateLyricIndex: vi.fn(),
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
      position: 0,
      lyricOffsetMs: 0,
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
  queueLength: { value: 2 },
  setQueue: vi.fn(),
  updateQueueTracks: vi.fn(),
}));
vi.mock("@/services/playback", () => ({
  setCurrentTime: vi.fn(),
  getCurrentTime: vi.fn(() => mocks.status.position),
  setSpeed: vi.fn(),
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
  invalidateNextTrackPreload: vi.fn(),
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
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("重载当前音源后作废旧槽位并重新准备下一首", async () => {
    mocks.status.position = 0;
    mocks.resolve.mockResolvedValue({
      source: "https://music/current",
      fromCache: false,
      provider: "official",
    });
    const { reloadCurrentTrack } = await import("./index");
    const preloader = await import("@/services/nextTrackPreloader");

    expect(await reloadCurrentTrack(false)).toBe(true);
    expect(preloader.invalidateNextTrackPreload).toHaveBeenCalledOnce();
    expect(preloader.scheduleNextTrackPreload).toHaveBeenCalledOnce();
  });

  it.each(["nextTrack", "playAtIndex"] as const)(
    "手动调用 %s 时复用预载槽位且不交叉淡化",
    async (method) => {
      mocks.status.currentTrack = mocks.track;
      mocks.consume.mockReturnValue({
        preparedId: "prepared",
        source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
      });
      const player = await import("./index");
      await (method === "nextTrack" ? player.nextTrack() : player.playAtIndex(1));
      expect(mocks.load).toHaveBeenCalledWith(
        "C:/cache/next.bin",
        expect.objectContaining({ preparedId: "prepared" }),
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );

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
    mocks.status.speed = 1;
    mocks.status.position = 0;
    mocks.status.state = "playing";
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

  it("交接采用真实锚点并保留暂停状态，不将歌词归零", async () => {
    mocks.transition.mockResolvedValue({
      success: true,
      data: {
        detail: {},
        mediaInfo: { duration: 1000 },
        playback: { position: 400, state: "paused", speed: 1.25, timestamp: Date.now() - 200 },
      },
    });
    const { trySmartTransition } = await import("./index");
    const clock = await import("@/services/playback");
    await trySmartTransition(5000);
    expect(mocks.status.position).toBe(400);
    expect(mocks.status.state).toBe("paused");
    expect(mocks.status.speed).toBe(1.25);
    expect(clock.setCurrentTime).toHaveBeenCalledWith(400, { force: true });
    expect(clock.setCurrentTime).not.toHaveBeenCalledWith(0, expect.anything());
    expect(mocks.media.updateLyricIndex).toHaveBeenCalledWith(400);
    expect(mocks.consume).toHaveBeenCalledTimes(1);
  });

  it("长静音尾部按有效结尾提前交接，保留原始时长", async () => {
    mocks.status.duration = 40000;
    mocks.transition.mockResolvedValue({ success: false });
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(20000, "next-slot", 25250);
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      5250,
      "standard",
      expect.any(Object),
    );
    expect(mocks.status.duration).toBe(40000);
  });

  it("积极档在两倍速下也能提前安排九秒窗口内的交接", async () => {
    mocks.status.duration = 40000;
    mocks.status.speed = 2;
    mocks.transitionPreference = "eager";
    mocks.transition.mockResolvedValue({ success: false });
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(23000, "next-slot");
    expect(mocks.transition).toHaveBeenCalledWith(
      "next-slot",
      "C:/cache/next.bin",
      8500,
      "eager",
      expect.any(Object),
    );
  });

  it("忽略后台迟到的其他槽位通知", async () => {
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000, "old-slot");
    expect(mocks.transition).not.toHaveBeenCalled();
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

  it("交接等待期间切换播放列表后丢弃旧交接结果", async () => {
    let completeTransition!: (result: {
      success: boolean;
      data: { detail: object; mediaInfo: { duration: number } };
    }) => void;
    mocks.transition.mockImplementation(
      () => new Promise((resolve) => (completeTransition = resolve)),
    );
    mocks.resolve.mockResolvedValue({
      source: "C:/music/chosen.wav",
      fromCache: false,
      provider: "local",
    });
    mocks.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    const player = await import("./index");
    const pending = player.trySmartTransition(5000);
    const chosen = { ...mocks.track, id: "chosen", title: "Chosen" };
    mocks.status.currentTrack = chosen;
    await player.playFrom([chosen as Track]);
    completeTransition({ success: true, data: { detail: {}, mediaInfo: { duration: 1000 } } });
    await pending;
    expect(mocks.media.track.id).toBe("chosen");
    expect(mocks.onTrackEnded).not.toHaveBeenCalled();
  });

  it("单曲循环时不提前交叉切换", async () => {
    mocks.status.repeatMode = "one";
    const { trySmartTransition } = await import("./index");
    await trySmartTransition(5000);
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
