import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  channel: "stable",
  autoCheck: true,
  packaged: true,
  dev: false,
  mac: false,
  portable: false,
  appx: false,
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  feed: vi.fn(),
  send: vi.fn(),
  open: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.packaged;
    },
    getVersion: () => "1.2.0-nightly.900",
  },
  shell: { openExternal: mocks.open },
}));
vi.mock("@main/utils/config", () => ({
  get isDev() {
    return mocks.dev;
  },
  get isMac() {
    return mocks.mac;
  },
  get isPortable() {
    return mocks.portable;
  },
  get isAppX() {
    return mocks.appx;
  },
}));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "update.channel" ? mocks.channel : mocks.autoCheck) },
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: mocks.send }));
vi.mock("@main/utils/logger", () => ({ updaterLog: { error: vi.fn() } }));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: Object.assign(new EventEmitter(), {
      checkForUpdates: mocks.check,
      downloadUpdate: mocks.download,
      quitAndInstall: mocks.install,
      setFeedURL: mocks.feed,
    }),
  },
  CancellationToken: class {
    cancel = mocks.cancel;
  },
}));

const info = {
  version: "1.3.0",
  releaseDate: "2026-09-30",
  releaseNotes: "notes",
  files: [{ url: "app-x64.exe", size: 10, sha512: "hash" }],
};
const available = { isUpdateAvailable: true, updateInfo: info };
const none = { isUpdateAvailable: false, updateInfo: info };

/** 显式控制底层任务的完成顺序，覆盖 IPC 与原生下载的交错。 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;

describe.each(["win32", "linux"])("统一更新任务（%s）", (platform) => {
  beforeEach(() => {
    // 显式模拟安装平台，避免普通 Node 环境误入 Electron 安装包检测
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: platform });
    vi.stubEnv("APPIMAGE", platform === "linux" ? "/opt/SPlayer.AppImage" : undefined);
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(mocks, {
      channel: "stable",
      autoCheck: true,
      packaged: true,
      dev: false,
      mac: false,
      portable: false,
      appx: false,
    });
    mocks.check.mockReset().mockResolvedValue(available);
    mocks.download.mockReset().mockResolvedValue([]);
    mocks.install.mockReset();
  });
  afterEach(async () => {
    try {
      (await import("./updater")).disposeUpdater();
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor);
      vi.unstubAllEnvs();
    }
  });

  it("nightly 安装版尊重显式 stable，且下载完成后不自动退出安装", async () => {
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    const updater = (await import("electron-updater")).default.autoUpdater;
    expect(updater.channel).toBe("latest");
    expect(updater.allowDowngrade).toBe(false);
    expect(service.getUpdateState().channel).toBe("stable");
    service.downloadUpdate();
    await flushPromises();
    expect(service.getUpdateState().phase).toBe("downloaded");
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("检查期间切换 A→B→A，旧结果不展示且只检查最后通道", async () => {
    const pending = deferred<typeof available>();
    mocks.check.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(none);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(false);
    mocks.channel = "beta";
    service.syncUpdateChannel();
    mocks.channel = "stable";
    service.syncUpdateChannel();
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    pending.resolve(available);
    await flushPromises();
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(service.getUpdateState()).toMatchObject({
      channel: "stable",
      phase: "upToDate",
      meta: null,
    });
    expect(mocks.send.mock.calls.some(([, event]) => event.notification === "available")).toBe(
      false,
    );
  });

  it("取消下载后等待旧 Promise 结束再切换 provider，旧成功不能恢复安装资格", async () => {
    const pending = deferred<string[]>();
    mocks.download.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    mocks.check.mockResolvedValueOnce(none);
    mocks.channel = "beta";
    service.syncUpdateChannel();
    expect(service.getUpdateState()).toMatchObject({ phase: "cancelling", meta: null });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    service.downloadUpdate();
    service.quitAndInstall();
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
    const updater = (await import("electron-updater")).default.autoUpdater;
    updater.emit("download-progress", {
      percent: 99,
      total: 100,
      delta: 99,
      transferred: 99,
      bytesPerSecond: 99,
    });
    updater.emit("update-downloaded", {
      ...info,
      path: "old.exe",
      sha512: "hash",
      downloadedFile: "old.exe",
    });
    expect(service.getUpdateState().percent).toBe(0);
    pending.resolve(["old.exe"]);
    await flushPromises();
    expect(mocks.feed).toHaveBeenCalledTimes(2);
    expect(service.getUpdateState().phase).toBe("upToDate");
  });

  it("已下载后切通道撤销显式安装资格", async () => {
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    await flushPromises();
    mocks.channel = "nightly";
    service.syncUpdateChannel();
    service.quitAndInstall();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(service.getUpdateState().meta).toBeNull();
    await flushPromises();
  });

  it("下载失败后手动检查刷新目标，自动检查不干扰错误状态", async () => {
    mocks.download.mockRejectedValueOnce(new Error("old nightly removed"));
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    await flushPromises();
    service.checkForUpdates(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    mocks.check.mockResolvedValueOnce({ ...available, updateInfo: { ...info, version: "1.4.0" } });
    service.checkForUpdates(true);
    expect(service.getUpdateState()).toMatchObject({ phase: "checking", meta: null });
    await flushPromises();
    expect(service.getUpdateState()).toMatchObject({
      phase: "available",
      meta: { version: "1.4.0" },
    });
  });

  it("下载失败与安装失败保留对应的重试目标", async () => {
    mocks.download.mockRejectedValueOnce(new Error("network"));
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    await flushPromises();
    expect(service.getUpdateState()).toMatchObject({
      phase: "error",
      error: { source: "download" },
      meta: { version: "1.3.0" },
    });
    service.checkForUpdates(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    service.downloadUpdate();
    await flushPromises();
    mocks.install.mockImplementationOnce(() => {
      throw new Error("installer");
    });
    service.quitAndInstall();
    expect(service.getUpdateState()).toMatchObject({
      phase: "error",
      error: { source: "install" },
    });
    service.quitAndInstall();
    expect(mocks.install).toHaveBeenCalledTimes(2);
  });

  it("下载及检查去重，手动加入自动检查仍能收到结果提示", async () => {
    const pending = deferred<typeof none>();
    mocks.check.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(false);
    service.checkForUpdates(true);
    service.downloadUpdate();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).not.toHaveBeenCalled();
    pending.resolve(none);
    await flushPromises();
    expect(mocks.send).toHaveBeenLastCalledWith(
      "update:event",
      expect.objectContaining({ notification: "upToDate", manual: true }),
    );
  });

  it.each(["dev", "mac", "portable"] as const)("%s 环境只能检查和打开外部下载", async (flag) => {
    mocks[flag] = true;
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    service.quitAndInstall();
    expect(service.getUpdateState().mode).toBe("external");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("商店版不检查 GitHub，直接打开商店", async () => {
    mocks.appx = true;
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    service.openDownloadPage();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith("ms-windows-store://updates");
  });

  it("销毁时取消下载，迟到错误不会重新检查或产生未处理 error", async () => {
    const pending = deferred<string[]>();
    mocks.download.mockReturnValueOnce(pending.promise);
    const service = await import("./updater");
    service.initUpdater();
    service.checkForUpdates(true);
    await flushPromises();
    service.downloadUpdate();
    service.disposeUpdater();
    const updater = (await import("electron-updater")).default.autoUpdater;
    expect(() => updater.emit("error", new Error("cancelled"))).not.toThrow();
    pending.reject(new Error("cancelled"));
    await flushPromises();
    expect(updater.listenerCount("error")).toBe(0);
    expect(mocks.check).toHaveBeenCalledOnce();
  });
});
