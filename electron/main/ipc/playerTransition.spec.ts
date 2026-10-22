import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  reset: [] as Array<() => void>,
  transition: vi.fn(),
  load: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  metadata: vi.fn(),
  prepareTransition: vi.fn(),
  cancel: vi.fn(),
  streamingPrepare: vi.fn(),
  streamingStart: vi.fn(),
  streamingStop: vi.fn(),
  mediaEvent: (_event: { type: string; positionMs?: number }) => {},
  scrobbleRestart: vi.fn(),
  lastfmRestart: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, callback),
    on: vi.fn(),
  },
  powerMonitor: { on: vi.fn() },
  app: { on: vi.fn() },
}));
vi.mock("@main/services/engine", () => {
  const player = {
    transitionToPrepared: mocks.transition,
    load: mocks.load,
    stop: mocks.stop,
    seek: mocks.seek,
    getDuration: () => 10,
    getPosition: () => 5,
    getSpeed: () => 1,
    getVolume: () => 1,
    getCoverRaw: () => null,
    getStatus: () => ({ state: "playing" }),
  };
  return {
    getPlayer: () => player,
    onPlayerCreated: vi.fn(),
    onPlayerReset: (callback: () => void) => mocks.reset.push(callback),
    resetPlayer: () => mocks.reset.forEach((callback) => callback()),
  };
});
vi.mock("@main/services/playerControl", () => ({
  playerControl: { syncQueueIndex: vi.fn() },
}));
vi.mock("@main/services/playerPreload", () => ({
  prepareNextTrack: vi.fn(),
  cancelPreparedTrack: mocks.cancel,
  takeTransitionReady: vi.fn(),
  setCurrentTransitionRange: vi.fn(),
  getTransitionEndMs: (end: number) => end,
}));
vi.mock("@main/utils/logger", () => ({
  playerLog: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/services/media", () => ({
  setMetadata: mocks.metadata,
  setPlayState: vi.fn(),
  setTimeline: vi.fn(),
  onEvent: (callback: typeof mocks.mediaEvent) => {
    mocks.mediaEvent = callback;
  },
}));
vi.mock("@main/services/nowPlaying", () => ({ prepareTransition: mocks.prepareTransition }));
vi.mock("@main/services/device", () => ({
  cancelPendingReinit: vi.fn(),
  startDeviceMonitoring: vi.fn(),
  stopDeviceMonitoring: vi.fn(),
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: vi.fn() }));
vi.mock("@main/server/broadcast", () => ({ wsBroadcast: vi.fn() }));
vi.mock("@main/utils/encoding", () => ({}));
vi.mock("@main/utils/protocol", () => ({ toCacheUrl: () => undefined }));
vi.mock("@main/utils/config", () => ({ appName: "SPlayer", getSongCacheDir: () => "cache" }));
vi.mock("@main/utils/fetchBytes", () => ({}));
vi.mock("@main/utils/powerBlocker", () => ({}));
vi.mock("@main/services/lastfm", () => ({
  onTrackLoaded: vi.fn(),
  onStopped: vi.fn(),
  onRepeatOneRestart: mocks.lastfmRestart,
}));
vi.mock("@main/services/neteaseScrobble", () => ({
  onTrackLoaded: vi.fn(),
  onStopped: vi.fn(),
  onRepeatOneRestart: mocks.scrobbleRestart,
}));
vi.mock("@main/services/streaming/playback", () => ({
  prepareStreamingPlayback: mocks.streamingPrepare,
  startStreamingPlayback: mocks.streamingStart,
  stopStreamingPlayback: mocks.streamingStop,
  onStreamingSeek: vi.fn(),
}));
vi.mock("@main/services/streaming/adapters/resolve", () => ({
  invalidateStreamingSession: vi.fn(),
}));
vi.mock("@main/services/songCache", () => ({}));
vi.mock("@main/services/thumbar", () => ({ getThumbar: () => null }));
vi.mock("@main/services/tray", () => ({ setTraySongName: vi.fn(), setTrayPlayState: vi.fn() }));
vi.mock("@main/services/thumbnail", () => ({ setTaskbarThumbnailCover: vi.fn() }));
vi.mock("@main/window", () => ({ getMainWindow: () => null }));
vi.mock("@main/store", () => ({ store: { get: () => false } }));

const meta = { title: "Next", duration: 10, artist: "", album: "" };
const options = { meta: { id: "next", title: "Next", source: "local", artists: [] } };

/**
 * 调用注册后的 IPC 处理器，验证原生响应提交顺序
 * @param name - IPC 通道
 * @param args - 通道参数
 * @returns 处理器返回值
 */
const invoke = (name: string, ...args: unknown[]) => mocks.handlers.get(name)!(null, ...args);

describe("交接响应的主进程竞态保护", () => {
  it("单曲重播先开启两种统计轮次，普通跳转不重置轮次", async () => {
    expect(await invoke("player:seek", 0, true)).toEqual({ success: true });
    expect(mocks.scrobbleRestart).toHaveBeenCalledOnce();
    expect(mocks.lastfmRestart).toHaveBeenCalledOnce();
    expect(mocks.scrobbleRestart.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.seek.mock.invocationCallOrder[0]!,
    );
    expect(await invoke("player:seek", 1000)).toEqual({ success: true });
    expect(mocks.scrobbleRestart).toHaveBeenCalledOnce();
    expect(mocks.lastfmRestart).toHaveBeenCalledOnce();
  });
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.reset.length = 0;
    mocks.seek.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue(meta);
    mocks.streamingPrepare.mockReset().mockResolvedValue(undefined);
    mocks.streamingStop.mockResolvedValue(undefined);
    const { registerPlayerIpc } = await import("./player");
    registerPlayerIpc();
  });

  it.each(["停止", "跳转", "重置", "加载新曲", "系统停止", "系统跳转"])(
    "%s 后不提交迟到的交接元数据",
    async (action) => {
      let finish!: (value: unknown) => void;
      mocks.transition.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = invoke(
        "player:transitionPrepared",
        "slot",
        "next.wav",
        5000,
        "standard",
        options,
      );
      if (action === "系统停止") mocks.mediaEvent({ type: "Stop" });
      if (action === "系统跳转") mocks.mediaEvent({ type: "Seek", positionMs: 1000 });
      if (action === "停止") await invoke("player:stop");
      if (action === "跳转") await invoke("player:seek", 1000);
      if (action === "重置") mocks.reset.forEach((callback) => callback());
      if (action === "加载新曲") await invoke("player:load", "chosen.wav", {});
      mocks.metadata.mockClear();
      finish(meta);
      expect(await pending).toEqual({ success: false });
      expect(mocks.metadata).not.toHaveBeenCalled();
      expect(mocks.prepareTransition).not.toHaveBeenCalled();
    },
  );

  it("停止后忽略旧交接错误，避免渲染端误触发下一曲", async () => {
    let reject!: (error: Error) => void;
    mocks.transition.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const pending = invoke(
      "player:transitionPrepared",
      "slot",
      "next.wav",
      5000,
      "standard",
      options,
    );
    await invoke("player:stop");
    reject(new Error("旧交接超时"));
    expect(await pending).toEqual({ success: false });
  });

  it("仍有效的交接正常更新媒体元数据", async () => {
    mocks.transition.mockResolvedValueOnce(meta);
    expect(
      await invoke("player:transitionPrepared", "slot", "next.wav", 5000, "standard", options),
    ).toMatchObject({ success: true, data: { playback: { state: "playing" } } });
    expect(mocks.metadata).toHaveBeenCalledOnce();
    expect(mocks.prepareTransition).toHaveBeenCalledOnce();
  });

  it("流媒体加载由主进程解析地址，解码成功后才绑定播放会话", async () => {
    mocks.streamingPrepare.mockResolvedValueOnce({
      url: "https://server/audio",
      sessionId: "new-play",
    });
    const track = {
      id: "server:song",
      originalId: "song",
      serverId: "server",
      source: "streaming",
      title: "歌曲",
      artists: [],
      duration: 10000,
    };
    expect(await invoke("player:load", "streaming://server/song", { meta: track })).toMatchObject({
      success: true,
    });
    expect(mocks.load).toHaveBeenCalledWith("https://server/audio", true, undefined);
    expect(mocks.streamingStart).toHaveBeenCalledWith(
      track,
      { url: "https://server/audio", sessionId: "new-play" },
      10000,
      true,
    );
  });

  it("停止时作废尚未完成的流媒体地址解析，不能产生迟到播放会话", async () => {
    let finish!: (value: unknown) => void;
    mocks.streamingPrepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const track = {
      id: "server:song",
      originalId: "song",
      serverId: "server",
      source: "streaming",
      title: "歌曲",
      artists: [],
      duration: 10000,
    };
    const pending = invoke("player:load", "streaming://server/song", { meta: track });
    await invoke("player:stop");
    finish({ url: "https://server/audio", sessionId: "old-play" });
    expect(await pending).toMatchObject({ success: false });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.streamingStart).not.toHaveBeenCalled();
  });

  it.each([
    ["[DecodeFailed] invalid audio data", "FILE_DECODE_ERROR"],
    ["[SourceNotFound] HTTP 404", "FILE_NOT_FOUND"],
    ["[NetworkUnreachable] connection refused", "NETWORK_ERROR"],
    ["[Device] output unavailable", "DEVICE_NOT_FOUND"],
    ["[Cancelled] superseded", "LOAD_SUPERSEDED"],
    ["unclassified remote error", "NETWORK_ERROR"],
  ])("远程音源保留原生错误分类 %s", async (message, error) => {
    mocks.load.mockRejectedValueOnce(new Error(message));
    expect(await invoke("player:load", "https://music/song.flac", {})).toEqual({
      success: false,
      error,
    });
  });
});
