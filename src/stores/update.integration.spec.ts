// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { UpdateEvent } from "@shared/types/update";
import { toast } from "@/composables/useToast";

const mock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler>();
  const config = { channel: "nightly" };
  let receiver: ((event: UpdateEvent) => void) | undefined;
  let finishCheck: (() => void) | undefined;
  let failCheck: ((error: Error) => void) | undefined;
  let finishDownload: (() => void) | undefined;
  let failDownload: ((error: Error) => void) | undefined;
  const autoUpdater = {
    channel: "",
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    forceDevUpdateConfig: false,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(() => {
      handlers.get("checking-for-update")?.();
      return new Promise<null>((resolve, reject) => {
        finishCheck = () => resolve(null);
        failCheck = reject;
      });
    }),
    downloadUpdate: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finishDownload = resolve;
          failDownload = reject;
        }),
    ),
    quitAndInstall: vi.fn(),
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
  };
  const info = (version: string) => ({
    version,
    releaseNotes: null,
    releaseDate: "2026-09-20T00:00:00.000Z",
    files: [{ url: `SPlayer-Next-${version}.exe`, size: 1024 }],
  });
  return {
    handlers,
    config,
    autoUpdater,
    info,
    get receiver() {
      return receiver;
    },
    set receiver(value: ((event: UpdateEvent) => void) | undefined) {
      receiver = value;
    },
    finishCheck: () => finishCheck?.(),
    failCheck: (error: Error) => failCheck?.(error),
    finishDownload: () => finishDownload?.(),
    failDownload: (error: Error) => failDownload?.(error),
    fire: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args),
  };
});

vi.mock("electron-updater", () => ({ default: { autoUpdater: mock.autoUpdater } }));
vi.mock("electron", () => ({
  app: { getVersion: () => "1.2.0-beta.1" },
  shell: { openExternal: vi.fn() },
}));
vi.mock("@main/utils/broadcast", () => ({
  sendToMain: (_channel: string, event: UpdateEvent) => mock.receiver?.(event),
}));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "update.channel" ? mock.config.channel : false) },
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
vi.mock("@/composables/useToast", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { useUpdateStore } from "./update";

// 动态导入隔离 Node/Web 两套 TypeScript 编译边界；Vitest 仍运行真实业务模块
const servicePath: string = "../../electron/main/services/updater";
let service: {
  disposeUpdater: () => void;
  initUpdater: () => void;
  checkForUpdates: (manual: boolean) => void;
  downloadUpdate: () => void;
  quitAndInstall: () => void;
  syncChannel: () => boolean;
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const available = async (version: string): Promise<void> => {
  mock.fire("update-available", mock.info(version));
  mock.finishCheck();
  await settle();
};

const downloaded = async (version: string): Promise<void> => {
  mock.fire("update-downloaded", mock.info(version));
  mock.finishDownload();
  await settle();
};

describe("更新器到界面的状态联动", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mock.handlers.clear();
    mock.config.channel = "nightly";
    setActivePinia(createPinia());
    service = await import(/* @vite-ignore */ servicePath);
    service.initUpdater();
    window.api = {
      update: {
        onEvent: (handler: (event: UpdateEvent) => void) => {
          mock.receiver = handler;
          return () => {
            mock.receiver = undefined;
          };
        },
        check: (manual: boolean) => {
          service.checkForUpdates(manual);
          return Promise.resolve();
        },
        download: () => {
          service.downloadUpdate();
          return Promise.resolve();
        },
        install: () => {
          service.quitAndInstall();
          return Promise.resolve();
        },
        openDownloadPage: () => Promise.resolve(),
      },
    } as unknown as typeof window.api;
  });

  afterEach(async () => {
    // 清理所有挂起的底层任务，让下一用例不受旧 Promise 和事件影响
    mock.finishCheck();
    mock.failDownload(new Error("cleanup"));
    await settle();
    service.disposeUpdater();
    mock.receiver = undefined;
    setActivePinia(createPinia());
  });

  it("A 下载中切 B，忙碌拒绝保留 B；旧 A 结果失效，B 下载完成可安装", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    await available("1.2.0-nightly.883");
    ui.download();
    expect(ui.phase).toBe("downloading");

    mock.config.channel = "beta";
    service.syncChannel();
    expect(ui.meta).toBeNull();
    expect(ui.dialogOpen).toBe(false);
    expect(ui.phase).toBe("checking");
    await available("1.2.0-beta.2");
    expect(ui.meta?.version).toBe("1.2.0-beta.2");
    ui.download();
    expect(ui.phase).toBe("available");
    expect(ui.meta?.version).toBe("1.2.0-beta.2");
    expect(toast.warning).toHaveBeenCalledWith("已有进行中的下载任务");

    mock.fire("download-progress", { percent: 90 });
    mock.fire("update-downloaded", mock.info("1.2.0-nightly.883"));
    mock.finishDownload();
    await settle();
    expect(ui.phase).toBe("available");
    expect(ui.meta?.version).toBe("1.2.0-beta.2");
    expect(mock.autoUpdater.autoInstallOnAppQuit).toBe(false);

    ui.download();
    expect(ui.phase).toBe("downloading");
    await downloaded("1.2.0-beta.2");
    expect(ui.phase).toBe("downloaded");
    ui.install();
    expect(mock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("A→B→A 切换不会重新认领旧 A 下载结果", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    await available("1.2.0-nightly.883");
    ui.download();
    mock.config.channel = "beta";
    service.syncChannel();
    mock.config.channel = "nightly";
    service.syncChannel();
    mock.fire("update-downloaded", mock.info("1.2.0-nightly.883"));
    mock.finishDownload();
    await settle();
    expect(ui.phase).toBe("idle");
    expect(ui.meta).toBeNull();
    expect(mock.autoUpdater.autoInstallOnAppQuit).toBe(false);
    mock.finishCheck();
    await settle();
    mock.finishCheck();
    await settle();
  });

  it("旧通道下载失败不会覆盖新通道已可用状态", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    await available("1.2.0-nightly.883");
    ui.download();
    mock.config.channel = "beta";
    service.syncChannel();
    await available("1.2.0-beta.2");
    mock.failDownload(new Error("old task failed"));
    await settle();
    expect(ui.phase).toBe("available");
    expect(ui.meta?.version).toBe("1.2.0-beta.2");
  });

  it("下载失败后通过界面重试并完成当前通道安装包", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    await available("1.2.0-nightly.883");
    ui.download();
    mock.failDownload(new Error("network down"));
    await settle();
    expect(ui.phase).toBe("error");
    expect(ui.errorSource).toBe("download");
    ui.retry();
    expect(ui.phase).toBe("downloading");
    await downloaded("1.2.0-nightly.883");
    expect(ui.phase).toBe("downloaded");
  });

  it("安装失败后从 About 手动检查可重新打开安装重试弹窗", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    await available("1.2.0-nightly.883");
    ui.download();
    await downloaded("1.2.0-nightly.883");
    ui.install();
    mock.fire("error", new Error("installer failed"));
    expect(ui.phase).toBe("error");
    expect(ui.errorSource).toBe("install");
    ui.dialogOpen = false;

    const checks = mock.autoUpdater.checkForUpdates.mock.calls.length;
    ui.checkManually();
    expect(mock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(checks);
    expect(ui.phase).toBe("error");
    expect(ui.dialogOpen).toBe(true);
    expect(ui.meta?.version).toBe("1.2.0-nightly.883");
    expect(ui.canInstall).toBe(true);
    expect(ui.errorSource).toBe("install");

    // 验证重试路由，不执行真实安装程序
    ui.retry();
    expect(mock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it("旧检查阻塞时立即失效，切到无更新通道后旧版本与按钮资格消失", async () => {
    const ui = useUpdateStore();
    ui.checkManually();
    mock.fire("update-available", mock.info("1.2.0-nightly.883"));
    expect(ui.meta?.version).toBe("1.2.0-nightly.883");
    mock.config.channel = "stable";
    service.syncChannel();
    expect(ui.meta).toBeNull();
    expect(ui.dialogOpen).toBe(false);
    expect(ui.hasUpdate).toBe(false);
    mock.finishCheck();
    await settle();
    mock.fire("update-not-available");
    mock.finishCheck();
    await settle();
    expect(ui.phase).toBe("upToDate");
    expect(ui.meta).toBeNull();
    expect(ui.hasUpdate).toBe(false);
  });
});
