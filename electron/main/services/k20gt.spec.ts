import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import { encodeK20GTReport } from "@shared/utils/k20gt";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  subscriptions: new Map<string, (...args: any[]) => void>(),
  windows: [] as any[],
  snap: null as unknown as NowPlayingSnapshot,
  sendToMain: vi.fn(),
  deviceSession: {
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    options: unknown;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      setWindowOpenHandler: vi.fn(),
      getURL: () => "http://localhost:14558/windows/k20gt/index.html",
    });
    /**
     * 记录专用设备窗口
     * @param options - 窗口配置
     */
    constructor(options: unknown) {
      this.options = options;
      mocks.windows.push(this);
    }
    /** 模拟页面加载 */
    loadURL = vi.fn().mockResolvedValue(undefined);
    /** 返回窗口销毁状态 */
    isDestroyed = () => this.destroyed;
    /** 释放窗口 */
    destroy = () => {
      this.destroyed = true;
    };
  },
  session: { fromPartition: () => mocks.deviceSession },
  ipcMain: {
    handle: (channel: string, callback: (...args: any[]) => any) =>
      mocks.handlers.set(channel, callback),
    on: (channel: string, callback: (...args: any[]) => any) =>
      mocks.listeners.set(channel, callback),
  },
}));
vi.mock("@main/store", () => ({ store: { get: (key: string) => mocks.settings[key] } }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn(), debug: vi.fn() } }));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: mocks.sendToMain }));
vi.mock("@main/services/nowPlaying", () => ({
  snapshot: () => mocks.snap,
  onLyricChange: (callback: () => void) => {
    mocks.subscriptions.set("lyric", callback);
    return () => mocks.subscriptions.delete("lyric");
  },
  onPositionSync: (callback: () => void) => {
    mocks.subscriptions.set("position", callback);
    return () => mocks.subscriptions.delete("position");
  },
  onLyricOffsetChange: (callback: () => void) => {
    mocks.subscriptions.set("offset", callback);
    return () => mocks.subscriptions.delete("offset");
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:14558");
  mocks.settings = { "k20gt.enabled": true, "k20gt.language": "original" };
  mocks.windows = [];
  mocks.handlers.clear();
  mocks.listeners.clear();
  mocks.subscriptions.clear();
  mocks.snap = {
    track: { id: "track", duration: 10000 },
    lyric: [
      {
        startTime: 1000,
        endTime: 5000,
        words: [{ word: "你".repeat(18) }],
        translatedLyric: "译文",
      },
    ],
    source: null,
    position: 1000,
    playing: true,
    state: "playing",
    speed: 1,
    lyricOffsetMs: 0,
    sendTimestamp: 10000,
  } as NowPlayingSnapshot;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("K20 GT 后台同步生命周期", () => {
  it("隐藏播放时按歌词分页，内容不变不重发，暂停后停止定时任务", async () => {
    const service = await import("./k20gt");
    service.registerK20GTIpc();
    await service.reloadK20GTConfig();
    const win = mocks.windows[0];
    expect(win.options.show).toBe(false);
    mocks.listeners.get("k20gt:worker-status")!(
      { sender: win.webContents },
      { state: "connected" },
    );
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      "k20gt:report",
      encodeK20GTReport("你".repeat(17)),
    );
    await vi.advanceTimersByTimeAsync(1900);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(win.webContents.send).toHaveBeenLastCalledWith("k20gt:report", encodeK20GTReport("你"));
    mocks.snap = {
      ...mocks.snap,
      position: 3000,
      state: "paused",
      playing: false,
    };
    mocks.subscriptions.get("position")!(mocks.snap);
    expect(vi.getTimerCount()).toBe(0);
    mocks.settings["k20gt.language"] = "translation";
    await service.reloadK20GTConfig();
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      "k20gt:report",
      encodeK20GTReport("译文"),
    );
    await service.shutdownK20GT();
    expect(win.destroyed).toBe(true);
    expect(mocks.subscriptions.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("未启用时不创建窗口，快速切换只保留一个窗口并隔离旧页面事件", async () => {
    const service = await import("./k20gt");
    service.registerK20GTIpc();
    mocks.settings["k20gt.enabled"] = false;
    await service.reloadK20GTConfig();
    expect(mocks.windows).toHaveLength(0);
    mocks.settings["k20gt.enabled"] = true;
    await Promise.all([service.reloadK20GTConfig(), service.reloadK20GTConfig()]);
    expect(mocks.windows).toHaveLength(1);
    const old = mocks.windows[0];
    await mocks.handlers.get("k20gt:reconnect")!();
    expect(old.destroyed).toBe(true);
    mocks.listeners.get("k20gt:worker-status")!(
      { sender: old.webContents },
      { state: "connected" },
    );
    expect(mocks.handlers.get("k20gt:getStatus")!().state).toBe("connecting");
    await service.shutdownK20GT();
  });

  it("仅向专用页面授权目标设备，其他来源和设备不获授权", async () => {
    const service = await import("./k20gt");
    await service.reloadK20GTConfig();
    const check = mocks.deviceSession.setPermissionCheckHandler.mock.lastCall![0];
    const device = mocks.deviceSession.setDevicePermissionHandler.mock.lastCall![0];
    const win = mocks.windows[0];
    const details = { isMainFrame: true, requestingUrl: win.webContents.getURL() };
    expect(check(win.webContents, "hid", "", details)).toBe(true);
    expect(check({}, "hid", "", details)).toBe(false);
    expect(
      check(win.webContents, "hid", "", { ...details, requestingUrl: "https://example.com" }),
    ).toBe(false);
    const permission = {
      deviceType: "hid",
      origin: "http://localhost:14558",
      device: { vendorId: 0x3837, productId: 0x60c6 },
    };
    expect(device(permission)).toBe(true);
    expect(device({ ...permission, origin: "https://example.com" })).toBe(false);
    expect(device({ ...permission, device: { vendorId: 1, productId: 1 } })).toBe(false);
    await service.shutdownK20GT();
  });

  it("USB 清理卡住时限时销毁页面，不阻止应用退出", async () => {
    const service = await import("./k20gt");
    await service.reloadK20GTConfig();
    const win = mocks.windows[0];
    win.webContents.executeJavaScript.mockImplementation(() => new Promise(() => {}));
    const closing = service.shutdownK20GT();
    await vi.advanceTimersByTimeAsync(1500);
    await closing;
    expect(win.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
