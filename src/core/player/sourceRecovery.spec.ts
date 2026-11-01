import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  stop: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/apis/netease", () => ({ netease: {}, neteaseCall: mocks.request }));
vi.mock("@/apis/song/qqmusic", () => ({ resolveQQMusicUrl: vi.fn() }));
vi.mock("@/apis/song/kugou", () => ({ resolveKugouUrl: vi.fn() }));
vi.mock("@/stores/user", () => ({
  useUserStore: () => ({ isLoggedIn: true, fetchStatus: async () => true }),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
    player: { songLevel: "hq", allowTrialPlay: false },
    system: { cache: { songCache: { enabled: false } }, player: { rememberLastTrack: true } },
    lyric: { cjkTransform: "none" },
  }),
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: [] }) }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("localforage", () => ({
  default: { createInstance: () => ({ setItem: async () => null }) },
}));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn(), onTrackEnded: vi.fn() }));
vi.mock("@/services/nextTrackPreloader", () => ({
  consumePreloadedTrack: () => null,
  invalidateNextTrackPreload: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({
  beginLoad: vi.fn(),
  loadForTrack: vi.fn(),
  watchLyricPreference: vi.fn(),
}));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn() }));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/composables/useDialog", () => ({ dialog: { alert: async () => undefined } }));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/i18n", () => ({
  default: { global: { t: (key: string) => key, te: () => true } },
}));

const tracks: Track[] = ["current", "next", "last"].map((id) => ({
  id,
  title: id,
  source: "netease",
  artists: [{ name: "测试歌手" }],
  duration: 180000,
}));
const oldUrl = "https://music.example/current?token=expired";
const newUrl = "https://music.example/current?token=fresh";
const resumePosition = 42000;

let player: typeof import("./index");
let events: typeof import("./events");
let playback: typeof import("@/services/playback");
let status: ReturnType<typeof import("@/stores/status").useStatusStore>;
let media: ReturnType<typeof import("@/stores/media").useMediaStore>;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  const { createPinia, setActivePinia } = await import("pinia");
  setActivePinia(createPinia());
  Object.assign(window, {
    api: {
      player: {
        load: mocks.load,
        play: mocks.play,
        pause: mocks.pause,
        seek: mocks.seek,
        stop: mocks.stop,
      },
      download: { lookup: async () => null },
      nowPlaying: { update: vi.fn() },
    },
  });
  mocks.load.mockResolvedValue({
    success: true,
    data: { detail: {}, mediaInfo: { duration: 180000 } },
  });
  mocks.play.mockResolvedValue({ success: true });
  mocks.pause.mockResolvedValue({ success: true });
  mocks.seek.mockResolvedValue({ success: true });
  mocks.stop.mockResolvedValue({ success: true });
  mocks.request.mockResolvedValue({ data: [{ url: newUrl, freeTrialInfo: null }] });
  const queue = await import("@/stores/queue");
  queue.setQueue(tracks);
  status = (await import("@/stores/status")).useStatusStore();
  media = (await import("@/stores/media")).useMediaStore();
  media.setTrack(tracks[0]!);
  status.playIndex = 0;
  status.state = "paused";
  status.position = resumePosition;
  status.duration = 180000;
  status.currentSource = oldUrl;
  playback = await import("@/services/playback");
  playback.setDuration(180000);
  playback.setCurrentTime(resumePosition, { force: true });
  playback.setPlaying(false);
  player = await import("./index");
  events = await import("./events");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("在线歌曲暂停后地址失效恢复", () => {
  it("暂停数小时后恢复，重新获取官方地址并从原进度续播当前歌曲", async () => {
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(playback.getCurrentTime()).toBe(resumePosition);
    expect(mocks.request).not.toHaveBeenCalled();

    await player.play();
    let finish!: (result: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recovery = events.handleEvent({ type: "sourceError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(status.trackLoading).toBe(true);
    await events.handleEvent({
      type: "status",
      data: {
        state: "stopped",
        position: resumePosition,
        duration: 180000,
        volume: 1,
        speed: 1,
        isFinished: false,
      },
    });
    finish({ data: [{ url: newUrl, freeTrialInfo: null }] });
    await recovery;

    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      "song_url",
      { id: "current", level: "exhigh" },
      { notifyAuthFailure: false },
    );
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
      newUrl,
      expect.objectContaining({ autoPlay: false }),
    );
    expect(mocks.seek).toHaveBeenCalledExactlyOnceWith(resumePosition);
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.seek.mock.invocationCallOrder[0]!,
    );
    expect(mocks.seek.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.play.mock.invocationCallOrder[1]!,
    );
    expect(mocks.play).toHaveBeenCalledTimes(2);
    expect(media.track?.id).toBe("current");
    expect(status.playIndex).toBe(0);
    expect(status.currentSource).toBe(newUrl);
    expect(status.state).toBe("playing");
    expect(status.position).toBe(resumePosition);
    expect(playback.getCurrentTime()).toBe(resumePosition);
    expect(status.trackLoading).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("保持暂停时收到源失效，刷新地址和进度但不自动播放", async () => {
    await events.handleEvent({ type: "sourceError" });
    expect(status.state).toBe("paused");
    expect(status.position).toBe(resumePosition);
    expect(media.track?.id).toBe("current");
    expect(mocks.seek).toHaveBeenCalledExactlyOnceWith(resumePosition);
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it.each([false, true])("重新取址仍无音源时只跳一首，恢复播放=%s", async (resume) => {
    if (resume) await player.play();
    mocks.request.mockResolvedValueOnce({ data: [{ url: null, fee: 0 }] });
    await events.handleEvent({ type: "sourceError" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(media.track?.id).toBe("next");
    expect(status.state).toBe(resume ? "playing" : "paused");
    expect(mocks.request.mock.calls.map((call) => call[1].id)).toEqual(["current", "next"]);
    expect(mocks.seek).not.toHaveBeenCalled();
  });

  it.each(["停止", "切歌"])("取址期间手动%s，旧地址返回后不复活旧歌曲", async (action) => {
    await player.play();
    let finish!: (result: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recovery = events.handleEvent({ type: "sourceError" });
    await vi.advanceTimersByTimeAsync(0);
    if (action === "停止") await player.stop();
    else await player.nextTrack();
    mocks.load.mockClear();
    mocks.play.mockClear();
    finish({ data: [{ url: newUrl, freeTrialInfo: null }] });
    await recovery;
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.seek).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(status.state).toBe(action === "停止" ? "stopped" : "playing");
    expect(media.track?.id).toBe(action === "停止" ? "current" : "next");
  });

  it("恢复进度期间手动停止，迟到的 seek 响应不能重新播放", async () => {
    await player.play();
    let finish!: (result: unknown) => void;
    mocks.seek.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recovery = events.handleEvent({ type: "sourceError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.seek).toHaveBeenCalledOnce();
    await player.stop();
    mocks.load.mockClear();
    mocks.play.mockClear();
    finish({ success: true });
    await recovery;
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(status.state).toBe("stopped");
  });

  it.each([false, true])("重新取址期间用户暂停，音源可用=%s 时仍保持暂停", async (available) => {
    await player.play();
    let finish!: (result: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recovery = events.handleEvent({ type: "sourceError" });
    await vi.advanceTimersByTimeAsync(0);
    await player.pause();
    mocks.play.mockClear();
    finish({ data: [{ url: available ? newUrl : null, freeTrialInfo: null }] });
    await recovery;
    expect(mocks.play).not.toHaveBeenCalled();
    expect(status.state).toBe("paused");
    expect(status.position).toBe(available ? resumePosition : 0);
    expect(media.track?.id).toBe(available ? "current" : "next");
  });
});
