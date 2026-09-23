// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 代次机制回归测试
 * updater.ts 在模块顶层就依赖 electron / electron-updater，因此用 vi.hoisted + vi.mock
 * 替换这些外部依赖，再手动派发事件复现竞态时序。测试自行结算任务，不依赖生产 dispose 兜底
 */
const hoisted = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler>();
  const sent: Array<Record<string, unknown>> = [];
  const config = { channel: "stable" };

  /**
   * 运行版本基线：mock 的 app.getVersion() 与测试构造的可用版本都以它为准，
   * 避免两处硬编码互相漂移
   */
  const APP_VERSION = "1.2.0-beta.1";

  /** 最近一次启动的下载任务，用于从外部决定它如何结算 */
  const task = {
    resolve: null as (() => void) | null,
    reject: null as ((error: unknown) => void) | null,
  };

  const autoUpdater = {
    channel: "",
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    setFeedURL: vi.fn(),
    /** 检查保持可控：默认立即完成，测试可改为挂起或失败 */
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          task.resolve = resolve;
          task.reject = (error): void => reject(error);
        }),
    ),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
  };

  const fire = (event: string, ...args: unknown[]): void => handlers.get(event)?.(...args);

  const info = (version: string) => ({
    version,
    files: [{ url: `SPlayer-Next-${version}-x64-setup.exe`, size: 1024 }],
    releaseDate: "2026-09-20T00:00:00.000Z",
    releaseNotes: null,
  });

  return { handlers, sent, config, autoUpdater, fire, info, task, APP_VERSION };
});

vi.mock("electron-updater", () => ({ default: { autoUpdater: hoisted.autoUpdater } }));
vi.mock("electron", () => ({
  app: { getVersion: () => hoisted.APP_VERSION },
  shell: { openExternal: vi.fn() },
}));
vi.mock("@main/utils/broadcast", () => ({
  sendToMain: (_channel: string, event: unknown) => {
    hoisted.sent.push(event as Record<string, unknown>);
  },
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => (key === "update.channel" ? hoisted.config.channel : true),
  },
}));
vi.mock("@main/utils/config", () => ({
  isDev: false,
  isMac: false,
  isPortable: false,
  isAppX: false,
}));
vi.mock("@main/utils/logger", () => ({
  updaterLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  checkForUpdates,
  disposeUpdater,
  downloadUpdate,
  initUpdater,
  quitAndInstall,
  syncChannel,
} from "./updater";

/** 运行版本基线，与 mock 的 app.getVersion() 同源 */
const CURRENT_VERSION = hoisted.APP_VERSION;

/** 当前可用的更新版本，需高于运行版本才会被真实逻辑视为更新 */
const AVAILABLE_VERSION = "1.2.0-nightly.883";

const eventsOfType = (type: string): Array<Record<string, unknown>> =>
  hoisted.sent.filter((event) => event.type === type);

/** 让已排队的 promise 回调与微任务跑完 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** 初始化并回到干净基线 */
const setup = (channel = "stable"): void => {
  hoisted.config.channel = channel;
  hoisted.sent.length = 0;
  hoisted.task.resolve = null;
  hoisted.task.reject = null;
  vi.clearAllMocks();
  initUpdater();
};

/** 发起一次检查，建立检查上下文 */
const startCheck = (): void => {
  checkForUpdates(true);
};

/** 仅派发检查结果，不自行发起检查（用于已存在检查上下文的场景） */
const fireAvailable = (version: string): void => {
  hoisted.fire("update-available", hoisted.info(version));
};

/** 完成一次「发起检查 → 返回可用更新」的完整流程 */
const givenAvailableUpdate = async (version: string): Promise<void> => {
  startCheck();
  fireAvailable(version);
  await settle();
};

/** 启动一次下载，返回结算控制器；任务在结算前保持挂起 */
const startDownload = (): {
  succeed: (version: string) => Promise<void>;
  fail: (error: Error) => Promise<void>;
} => {
  downloadUpdate();
  return {
    // 与 electron-updater 的真实顺序一致：先派发 update-downloaded，Promise 之后才结算
    succeed: async (version: string): Promise<void> => {
      hoisted.fire("update-downloaded", hoisted.info(version));
      hoisted.task.resolve?.();
      await settle();
    },
    fail: async (error: Error): Promise<void> => {
      hoisted.task.reject?.(error);
      await settle();
    },
  };
};

describe("更新器任务归属（代次机制）", () => {
  beforeEach(() => {
    hoisted.handlers.clear();
  });

  afterEach(() => {
    disposeUpdater();
  });

  it("检查进行中切换通道后，旧检查结果被丢弃", async () => {
    setup("nightly");
    startCheck();

    // 检查尚未返回时切换通道
    hoisted.config.channel = "beta";
    syncChannel();

    // 旧检查此时才返回可用更新
    hoisted.fire("update-available", hoisted.info("1.2.0-nightly.883"));

    expect(eventsOfType("available")).toHaveLength(0);
  });

  it("属于当前通道的检查结果正常上报", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");

    const available = eventsOfType("available");
    expect(available).toHaveLength(1);
    expect(available[0].meta).toMatchObject({ version: "1.2.0-nightly.883" });
  });

  it("已有进行中的下载时拒绝新的下载请求", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");

    const download = startDownload();
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    // electron-updater 对已有任务会返回原 Promise，因此第二个请求必须被拒绝
    downloadUpdate();
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(eventsOfType("downloadRejected")).toContainEqual({
      type: "downloadRejected",
      reason: "busy",
    });

    await download.succeed("1.2.0-nightly.883");
  });

  it("下载结算后任务上下文被释放，可以再次发起下载", async () => {
    setup("nightly");
    await givenAvailableUpdate(AVAILABLE_VERSION);

    const first = startDownload();
    await first.succeed(AVAILABLE_VERSION);

    // 若收尾时未清空下载上下文，这里会被当成并发请求而拒绝
    hoisted.autoUpdater.downloadUpdate.mockClear();
    const second = startDownload();
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    await second.fail(new Error("cleanup"));
  });

  it("下载失败结算后任务上下文被释放，可以再次发起下载", async () => {
    setup("nightly");
    await givenAvailableUpdate(AVAILABLE_VERSION);

    const first = startDownload();
    await first.fail(new Error("network down"));

    hoisted.sent.length = 0;
    hoisted.autoUpdater.downloadUpdate.mockClear();
    const second = startDownload();

    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(eventsOfType("error")).toHaveLength(0);

    await second.fail(new Error("cleanup"));
  });

  it("切换通道后完成的旧下载不再具备安装资格", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");
    const download = startDownload();

    // 下载进行中切换通道
    hoisted.config.channel = "beta";
    syncChannel();
    hoisted.sent.length = 0;

    // 旧下载此刻才完成
    await download.succeed("1.2.0-nightly.883");

    expect(eventsOfType("downloaded")).toHaveLength(0);
    expect(hoisted.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("切换通道会撤销安装资格，新通道完成下载后才恢复", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");
    const first = startDownload();
    await first.succeed("1.2.0-nightly.883");
    expect(hoisted.autoUpdater.autoInstallOnAppQuit).toBe(true);

    // 切通道应撤销资格
    hoisted.config.channel = "beta";
    syncChannel();
    expect(hoisted.autoUpdater.autoInstallOnAppQuit).toBe(false);
    hoisted.sent.length = 0;

    // 新通道完成检查与下载后才恢复；syncChannel 已发起过检查，这里只补派发结果
    fireAvailable("1.2.0-beta.2");
    await settle();
    const second = startDownload();
    await second.succeed("1.2.0-beta.2");

    expect(eventsOfType("downloaded")).toHaveLength(1);
    expect(hoisted.autoUpdater.autoInstallOnAppQuit).toBe(true);

    // 资格恢复后显式安装获准
    quitAndInstall();
    expect(hoisted.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("旧下载失败不会被推送到界面", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");

    const download = startDownload();
    hoisted.config.channel = "beta";
    syncChannel();
    hoisted.sent.length = 0;

    await download.fail(new Error("network down"));

    expect(eventsOfType("error")).toHaveLength(0);
  });

  it("当前通道的下载失败会上报一次", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");

    const download = startDownload();
    hoisted.sent.length = 0;

    await download.fail(new Error("network down"));

    const errors = eventsOfType("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("network down");
  });

  it("底层同时派发 error 与 reject 时只反馈一次", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");

    const download = startDownload();
    hoisted.sent.length = 0;

    // electron-updater 在失败时既派发全局 error 事件、也让 Promise 失败
    hoisted.fire("error", new Error("network down"));
    await download.fail(new Error("network down"));

    expect(eventsOfType("error")).toHaveLength(1);
  });

  it("检查失败时上报一次", async () => {
    setup("nightly");
    hoisted.autoUpdater.checkForUpdates.mockImplementationOnce(() =>
      Promise.reject(new Error("check failed")),
    );
    hoisted.sent.length = 0;

    checkForUpdates(true);
    await settle();

    const errors = eventsOfType("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("check failed");
  });

  it("显式安装失败上报一次，且标记被清除", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");
    const download = startDownload();
    await download.succeed("1.2.0-nightly.883");
    hoisted.sent.length = 0;

    quitAndInstall();
    expect(hoisted.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);

    // 安装阶段底层派发的错误需要单独反馈
    hoisted.fire("error", new Error("installer failed"));
    expect(eventsOfType("error")).toHaveLength(1);

    // 标记已清除，后续无来源的错误不再重复上报
    hoisted.fire("error", new Error("late error"));
    expect(eventsOfType("error")).toHaveLength(1);
  });

  it("切换通道后拒绝安装旧通道的包", async () => {
    setup("nightly");
    await givenAvailableUpdate("1.2.0-nightly.883");
    const download = startDownload();
    await download.succeed("1.2.0-nightly.883");

    hoisted.config.channel = "beta";
    syncChannel();
    quitAndInstall();

    expect(hoisted.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("通道未变化时不做失效也不触发检查", async () => {
    setup("stable");
    await settle();
    hoisted.sent.length = 0;
    hoisted.autoUpdater.checkForUpdates.mockClear();

    expect(syncChannel()).toBe(false);
    expect(hoisted.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(hoisted.sent).toHaveLength(0);
  });

  it("切换通道后旧的可用结果失效，下载请求被拒绝", async () => {
    setup("stable");
    await givenAvailableUpdate("1.3.0");
    await settle();

    hoisted.config.channel = "nightly";
    expect(syncChannel()).toBe(true);
    hoisted.autoUpdater.downloadUpdate.mockClear();
    hoisted.sent.length = 0;

    // 新检查尚未结算，旧结果的来源通道已不匹配，必须拒绝下载
    downloadUpdate();

    expect(hoisted.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(eventsOfType("downloadRejected")).toContainEqual({
      type: "downloadRejected",
      reason: "checking",
    });
  });

  it("旧检查挂起时切换通道立即通知失效，旧事件不会提前触发新检查", async () => {
    setup("nightly");
    let finishOldCheck: (() => void) | undefined;
    hoisted.autoUpdater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finishOldCheck = () => resolve(null);
        }),
    );
    checkForUpdates(true);
    fireAvailable(AVAILABLE_VERSION);
    hoisted.sent.length = 0;

    hoisted.config.channel = "beta";
    syncChannel();
    expect(eventsOfType("invalidated")).toHaveLength(1);
    expect(hoisted.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    hoisted.fire("update-not-available");
    expect(eventsOfType("notAvailable")).toHaveLength(0);

    finishOldCheck?.();
    await settle();
    expect(hoisted.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(eventsOfType("invalidated")).toHaveLength(1);
  });

  it("A 下载中切 B，B 可用仍拒绝并发下载且旧结果不恢复安装资格", async () => {
    setup("nightly");
    await givenAvailableUpdate(AVAILABLE_VERSION);
    const oldDownload = startDownload();
    await settle();
    let finishBetaCheck: (() => void) | undefined;
    hoisted.autoUpdater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finishBetaCheck = () => resolve(null);
        }),
    );
    hoisted.config.channel = "beta";
    syncChannel();
    expect(eventsOfType("invalidated")).toHaveLength(1);
    hoisted.sent.length = 0;
    fireAvailable("1.2.0-beta.2");
    expect(eventsOfType("available")).toHaveLength(1);
    finishBetaCheck?.();
    await settle();

    downloadUpdate();
    expect(eventsOfType("downloadRejected")).toContainEqual({
      type: "downloadRejected",
      reason: "busy",
    });
    expect(eventsOfType("error")).toHaveLength(0);
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    hoisted.fire("download-progress", { percent: 95 });
    expect(eventsOfType("progress")).toHaveLength(0);
    await oldDownload.succeed(AVAILABLE_VERSION);
    expect(eventsOfType("downloaded")).toHaveLength(0);
    expect(hoisted.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("同通道下载中及已下载时不启动新检查，下载失败后仍可重试", async () => {
    setup("nightly");
    await givenAvailableUpdate(AVAILABLE_VERSION);
    const first = startDownload();
    hoisted.autoUpdater.checkForUpdates.mockClear();
    checkForUpdates(true);
    expect(hoisted.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    await first.fail(new Error("network down"));
    const second = startDownload();
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
    await second.succeed(AVAILABLE_VERSION);
    checkForUpdates(true);
    expect(hoisted.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(eventsOfType("downloaded")).toHaveLength(1);
  });

  it("当前通道检查未结算时不能下载，结算后可下载", async () => {
    setup("nightly");
    let finishCheck: (() => void) | undefined;
    hoisted.autoUpdater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finishCheck = () => resolve(null);
        }),
    );
    checkForUpdates(true);
    fireAvailable(AVAILABLE_VERSION);
    downloadUpdate();
    expect(eventsOfType("downloadRejected")).toContainEqual({
      type: "downloadRejected",
      reason: "checking",
    });
    expect(hoisted.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    finishCheck?.();
    await settle();
    const download = startDownload();
    expect(hoisted.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    await download.succeed(AVAILABLE_VERSION);
  });

  it("切换到无更新的通道时旧版本信息不会再次出现", async () => {
    setup("nightly");
    await givenAvailableUpdate(AVAILABLE_VERSION);
    hoisted.config.channel = "stable";
    syncChannel();
    expect(eventsOfType("invalidated")).toHaveLength(1);
    hoisted.fire("update-not-available");
    expect(eventsOfType("notAvailable")).toHaveLength(1);
    expect(eventsOfType("available")).toHaveLength(1);
  });

  it("切换通道后按新通道重新检查", async () => {
    setup("stable");
    await settle();
    hoisted.autoUpdater.checkForUpdates.mockClear();

    hoisted.config.channel = "nightly";
    expect(syncChannel()).toBe(true);

    expect(hoisted.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(eventsOfType("available")).toHaveLength(0);
  });
});

describe("更新器版本基线", () => {
  it("mock 的运行版本与测试基线同源", async () => {
    // 直接读取 mock 实际返回的版本，避免两处硬编码各自漂移
    const { app } = await import("electron");
    expect(app.getVersion()).toBe(CURRENT_VERSION);
  });
});
