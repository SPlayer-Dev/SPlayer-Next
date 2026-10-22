import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState, Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => {
  const tracks: Track[] = ["first", "second", "third"].map((id) => ({
    id,
    title: id,
    source: "local",
    path: `C:/music/${id}.flac`,
    artists: [],
    duration: 10000,
  }));
  const queue = { value: tracks };
  const media = {
    track: null as Track | null,
    setTrack(track: Track) {
      this.track = track;
    },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
    setLyric: vi.fn(),
  };
  const status = {
    state: "playing" as PlayerState,
    playIndex: 0,
    fmMode: false,
    repeatMode: "list",
    shuffleMode: "off",
    trackLoading: false,
    transitioning: false,
    position: 0,
    duration: 10000,
    volume: 1,
    speed: 1,
    abLoop: { enable: false },
    currentSource: null as string | null,
    get isPlaying() {
      return this.state === "playing";
    },
    get currentTrack() {
      return queue.value[this.playIndex] ?? null;
    },
  };
  return {
    tracks,
    queue,
    media,
    status,
    resolve: vi.fn(),
    load: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stopAfterEnd: false,
    fmStart: vi.fn(),
    fmNext: vi.fn(),
    transition: vi.fn(),
    toast: vi.fn(),
    alert: vi.fn(),
  };
});

vi.mock("./fm", () => ({ start: mocks.fmStart, next: mocks.fmNext }));
vi.mock("./stats", () => ({ installPlayStats: vi.fn(), onTrackEnded: vi.fn() }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => mocks.media }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
    player: { transitionMode: "crossfade", transitionPreference: "standard" },
  }),
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("@/stores/queue", () => ({
  queue: mocks.queue,
  queueLength: {
    get value() {
      return mocks.queue.value.length;
    },
  },
  updateQueueTracks: vi.fn(),
}));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/nextTrackPreloader", () => ({
  consumePreloadedTrack: () => null,
  invalidateNextTrackPreload: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
  beginPreparedTransition: () => ({
    preparedId: "next-slot",
    source: { source: mocks.tracks[1]!.path, provider: "local", fromCache: false },
  }),
  finishPreparedTransition: vi.fn(),
}));
vi.mock("@/services/playback", () => ({
  setCurrentTime: vi.fn((position) => position),
  setDuration: vi.fn(),
  setPlaying: vi.fn(),
  setSeeking: vi.fn(),
  setSpeed: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn() }));
vi.mock("@/services/autoClose", () => ({
  onTrackEnded: () => mocks.stopAfterEnd,
  shouldStopAfterCurrentTrack: () => false,
}));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/composables/useDialog", () => ({ dialog: { alert: mocks.alert } }));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/i18n", () => ({
  default: { global: { t: (key: string) => key, te: () => true } },
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.queue.value = [...mocks.tracks];
  mocks.stopAfterEnd = false;
  mocks.media.track = null;
  Object.assign(mocks.status, {
    state: "playing",
    playIndex: 0,
    fmMode: false,
    repeatMode: "list",
    trackLoading: false,
    currentSource: null,
    duration: 10000,
  });
  mocks.resolve.mockImplementation(async (track: Track) => ({
    source: track.path,
    provider: "local",
    fromCache: false,
  }));
  mocks.load.mockResolvedValue({
    success: true,
    data: { detail: {}, mediaInfo: { duration: 10000 } },
  });
  mocks.stop.mockResolvedValue({ success: true });
  mocks.seek.mockResolvedValue({ success: true });
  mocks.play.mockResolvedValue({ success: true });
  mocks.pause.mockResolvedValue({ success: true });
  mocks.alert.mockResolvedValue(undefined);
  Object.assign(window, {
    api: {
      player: {
        load: mocks.load,
        stop: mocks.stop,
        seek: mocks.seek,
        play: mocks.play,
        pause: mocks.pause,
        transitionPrepared: mocks.transition,
      },
    },
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/**
 * 模拟原生停止通知晚于 IPC 响应到达
 * @param state - 原生播放器状态
 */
const sendStatus = async (state: PlayerState): Promise<void> => {
  const { handleEvent } = await import("./events");
  await handleEvent({
    type: "status",
    data: { state, position: 0, duration: 0, volume: 1, speed: 1, isFinished: false },
  });
};

describe("单曲失败自动跳曲", () => {
  it("自然单曲重播明确通知主进程开启新轮次，睡眠定时停止时不重播", async () => {
    mocks.media.track = mocks.tracks[0]!;
    mocks.status.repeatMode = "one";
    mocks.status.state = "stopped";
    /** 原生 seek 从曲尾重播时会先发送播放状态，再返回跳转结果 */
    mocks.seek.mockImplementation(async () => {
      mocks.status.state = "playing";
      return { success: true };
    });
    const { handleEvent } = await import("./events");
    await handleEvent({ type: "ended" });
    expect(mocks.seek).toHaveBeenCalledExactlyOnceWith(0, true);
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.stopAfterEnd = true;
    await handleEvent({ type: "ended" });
    expect(mocks.seek).toHaveBeenCalledOnce();
    expect(mocks.play).toHaveBeenCalledOnce();
  });

  it.each(["streaming://server/song", "C:/cache/song.flac"])(
    "流媒体单曲重播重新加载 %s，保留队列位置且不复用旧会话",
    async (source) => {
      const track: Track = {
        ...mocks.tracks[0]!,
        source: "streaming",
        serverId: "server",
        originalId: "song",
      };
      mocks.media.track = track;
      mocks.status.repeatMode = "one";
      mocks.status.state = "stopped";
      mocks.resolve.mockResolvedValue({ source, provider: "streaming", fromCache: false });
      const { handleEvent } = await import("./events");
      await handleEvent({ type: "ended" });
      expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
        source,
        expect.objectContaining({ meta: track, autoPlay: false }),
      );
      expect(mocks.seek).not.toHaveBeenCalled();
      expect(mocks.play).toHaveBeenCalledOnce();
      expect(mocks.status.playIndex).toBe(0);
      expect(mocks.status.state).toBe("playing");
    },
  );

  it.each(["暂停", "停止", "切歌"])(
    "流媒体重播取址期间手动%s，迟到响应不恢复旧播放",
    async (action) => {
      mocks.media.track = {
        ...mocks.tracks[0]!,
        source: "streaming",
        serverId: "server",
        originalId: "song",
      };
      mocks.status.repeatMode = "one";
      mocks.status.state = "stopped";
      let finish!: (value: unknown) => void;
      mocks.resolve.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { handleEvent } = await import("./events");
      const player = await import("./index");
      const pending = handleEvent({ type: "ended" });
      if (action === "暂停") await player.pause();
      else if (action === "停止") await player.stop();
      else await player.nextTrack();
      mocks.load.mockClear();
      mocks.play.mockClear();
      finish({ source: "streaming://server/song", provider: "streaming", fromCache: false });
      await pending;
      expect(mocks.play).not.toHaveBeenCalled();
      expect(mocks.status.state).toBe(
        action === "暂停" ? "paused" : action === "停止" ? "stopped" : "playing",
      );
      expect(mocks.media.track?.id).toBe(action === "切歌" ? "second" : "first");
      if (action !== "暂停") expect(mocks.load).not.toHaveBeenCalled();
    },
  );

  it("流媒体重播加载失败不调用播放，重复结束通知不重复加载", async () => {
    mocks.media.track = {
      ...mocks.tracks[0]!,
      source: "streaming",
      serverId: "server",
      originalId: "song",
    };
    mocks.status.repeatMode = "one";
    let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { handleEvent } = await import("./events");
    const pending = handleEvent({ type: "ended" });
    await vi.advanceTimersByTimeAsync(0);
    await handleEvent({ type: "ended" });
    expect(mocks.load).toHaveBeenCalledOnce();
    finish({ success: false, error: ErrorCode.NETWORK_ERROR });
    await pending;
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.status.state).toBe("idle");
  });
  it.each([ErrorCode.NETEASE_UNAVAILABLE, ErrorCode.NO_PLUGIN_AVAILABLE, ErrorCode.FILE_NOT_FOUND])(
    "%s 遇到迟到的停止通知仍自动播放下一首",
    async (error) => {
      mocks.resolve.mockImplementationOnce((_track, options) => {
        options.onError(error);
        return null;
      });
      const { nextTrack } = await import("./index");
      await nextTrack();
      await sendStatus("stopped");
      await sendStatus("idle");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.media.track?.id).toBe("third");
      expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
        mocks.tracks[2]!.path,
        expect.objectContaining({ autoPlay: true }),
      );
      expect(mocks.status.state).toBe("playing");
    },
  );

  it.each(["list", "one"])("%s 模式解码失败后跳过坏歌", async (repeatMode) => {
    mocks.status.repeatMode = repeatMode;
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack } = await import("./index");
    await nextTrack();
    await sendStatus("stopped");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.media.track?.id).toBe("third");
    expect(mocks.status.state).toBe("playing");
  });

  it("手动停止会取消待执行的自动跳曲", async () => {
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack, stop } = await import("./index");
    await nextTrack();
    await stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.status.state).toBe("stopped");
  });

  it("手动切歌后旧失败不再多跳一首", async () => {
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack } = await import("./index");
    await nextTrack();
    await nextTrack();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.media.track?.id).toBe("third");
  });

  it("官方音源解码失败时先尝试插件，成功则继续当前歌曲", async () => {
    mocks.resolve.mockResolvedValueOnce({
      source: "https://official/song",
      provider: "official",
      fromCache: false,
    });
    mocks.resolve.mockResolvedValueOnce({
      source: "https://plugin/song",
      provider: "plugin",
      pluginId: "fallback",
      fromCache: false,
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack } = await import("./index");
    await nextTrack();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.load).toHaveBeenLastCalledWith(
      "https://plugin/song",
      expect.objectContaining({ autoPlay: true }),
    );
    expect(mocks.media.track?.id).toBe("second");
    expect(mocks.status.state).toBe("playing");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("暂停态恢复失败后的自动跳曲保持暂停", async () => {
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack } = await import("./index");
    await nextTrack(false);
    await sendStatus("stopped");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.media.track?.id).toBe("third");
    expect(mocks.load).toHaveBeenLastCalledWith(
      mocks.tracks[2]!.path,
      expect.objectContaining({ autoPlay: false }),
    );
    expect(mocks.status.state).toBe("paused");
  });

  it.each(["idle", "stopped"] as const)("正常播放收到 %s 仍取消在途交叉过渡", async (state) => {
    let finish!: (result: unknown) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { trySmartTransition } = await import("./index");
    const pending = trySmartTransition(8000);
    expect(mocks.transition).toHaveBeenCalledOnce();
    await sendStatus(state);
    finish({ success: true, data: { detail: {}, mediaInfo: { duration: 10000 } } });
    await pending;
    expect(mocks.status.state).toBe(state);
    expect(mocks.status.playIndex).toBe(0);
    expect(mocks.media.track).toBeNull();
  });

  it.each([ErrorCode.NETWORK_ERROR, ErrorCode.NETWORK_TIMEOUT, ErrorCode.DEVICE_NOT_FOUND])(
    "%s 不触发连续跳曲",
    async (error) => {
      mocks.load.mockResolvedValueOnce({ success: false, error });
      const { nextTrack } = await import("./index");
      await nextTrack();
      await sendStatus("stopped");
      await vi.advanceTimersByTimeAsync(5000);
      expect(mocks.load).toHaveBeenCalledOnce();
      expect(mocks.media.track?.id).toBe("second");
    },
  );

  it("整队列失败后停止，避免无限回绕", async () => {
    mocks.load.mockResolvedValue({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { nextTrack } = await import("./index");
    await nextTrack();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.load).toHaveBeenCalledTimes(3);
    expect(mocks.status.state).toBe("stopped");
  });

  it.each([0, 1])("私人 FM 失败不受普通队列长度 %s 限制", async (length) => {
    mocks.queue.value = mocks.tracks.slice(0, length);
    mocks.fmStart.mockResolvedValue(mocks.tracks[0]);
    mocks.fmNext.mockResolvedValue(mocks.tracks[1]);
    mocks.load.mockResolvedValueOnce({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { playPersonalFm } = await import("./index");
    await playPersonalFm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.fmNext).toHaveBeenCalledOnce();
    expect(mocks.media.track?.id).toBe("second");
    expect(mocks.status.state).toBe("playing");
  });

  it("私人 FM 连续五首失败后停止", async () => {
    mocks.queue.value = [];
    mocks.fmStart.mockResolvedValue(mocks.tracks[0]);
    mocks.fmNext.mockResolvedValue(mocks.tracks[1]);
    mocks.load.mockResolvedValue({ success: false, error: ErrorCode.FILE_DECODE_ERROR });
    const { playPersonalFm } = await import("./index");
    await playPersonalFm();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.load).toHaveBeenCalledTimes(5);
    expect(mocks.toast).toHaveBeenLastCalledWith("errors.MAX_CONSECUTIVE_FAILURES");
    expect(mocks.status.state).toBe("stopped");
  });
});
