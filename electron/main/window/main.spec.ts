import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  main: null as any,
  order: [] as string[],
  settings: {} as Record<string, unknown>,
  createWindow: vi.fn(),
  platform: "darwin",
}));

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("./create", () => ({ createWindow: mocks.createWindow }));
vi.mock("@main/utils/logger", () => ({ coreLog: { error: vi.fn() } }));
vi.mock("@main/utils/powerBlocker", () => ({
  setMainWindowVisible: vi.fn(),
  setPlayerExpanded: vi.fn(),
}));
vi.mock("@main/services/thumbar", () => ({ initThumbar: vi.fn() }));
vi.mock("@main/services/thumbnail", () => ({ enableTaskbarThumbnail: vi.fn() }));
vi.mock("@main/services/tray", () => ({ initTray: vi.fn() }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => mocks.settings[key],
    set: vi.fn(),
  },
}));
vi.mock("@main/utils/protocol", () => ({
  MAIN_PARTITION: "persist:main",
  handleCacheProtocolOnPartition: vi.fn(),
}));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => false }));
vi.mock("@main/utils/config", () => ({
  /** 是否使用 macOS 原生窗口按钮 */
  get isMac() {
    return mocks.platform === "darwin";
  },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  mocks.order = [];
  mocks.platform = "darwin";
  mocks.settings = { "system.onboardingCompleted": true, "system.agreedAgreementVersion": 100 };
  mocks.main = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomFactor: () => 1,
    }),
    loadFile: vi.fn().mockResolvedValue(undefined),
    isDestroyed: () => false,
    isMinimized: () => false,
    show: vi.fn(() => {
      mocks.order.push("main-show");
      mocks.main.emit("show");
    }),
    focus: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
  });
  mocks.createWindow.mockClear();
  mocks.createWindow.mockImplementation(() => mocks.main);
});

describe("主窗口启动交接", () => {
  it("macOS 有边框窗口在启动画面期间隐藏按钮，启动完成后恢复", async () => {
    mocks.settings["system.borderlessWindow"] = false;
    const service = await import("./main");
    service.createMainWindow();
    expect(mocks.main.setWindowButtonVisibility.mock.calls).toEqual([[false]]);
    mocks.main.emit("ready-to-show");
    await service.showReadyMainWindow();
    service.focusMainWindow();
    expect(mocks.main.setWindowButtonVisibility.mock.calls).toEqual([[false]]);
    service.completeMainWindowStartup();
    expect(mocks.main.setWindowButtonVisibility.mock.calls).toEqual([[false], [true]]);
  });

  it.each<[string, boolean]>([
    ["darwin", true],
    ["win32", false],
    ["linux", false],
  ])("%s 无原生标题栏时不操作窗口按钮", async (platform, borderlessWindow) => {
    mocks.platform = platform;
    mocks.settings["system.borderlessWindow"] = borderlessWindow;
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.emit("ready-to-show");
    await service.showReadyMainWindow();
    service.completeMainWindowStartup();
    expect(mocks.main.setWindowButtonVisibility).not.toHaveBeenCalled();
  });

  it("启动完成前窗口销毁时不再恢复原生按钮", async () => {
    mocks.settings["system.borderlessWindow"] = false;
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.isDestroyed = () => true;
    service.completeMainWindowStartup();
    expect(mocks.main.setWindowButtonVisibility.mock.calls).toEqual([[false]]);
  });

  it("启动完成前缓存沉浸状态，完成后才允许切换原生按钮", async () => {
    mocks.settings["system.borderlessWindow"] = false;
    const service = await import("./main");
    service.createMainWindow();
    service.setMainWindowTrafficLightsVisible(false);
    expect(mocks.main.setWindowButtonVisibility.mock.calls).toEqual([[false]]);
    service.completeMainWindowStartup();
    expect(mocks.main.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    service.setMainWindowTrafficLightsVisible(true);
    expect(mocks.main.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    service.setMainWindowTrafficLightsVisible(false);
    expect(mocks.main.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    mocks.main.webContents.emit("render-process-gone");
    expect(mocks.main.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
  });

  it.each(["darwin", "win32", "linux"])(
    "%s 仅在 macOS 有边框模式叠加原生按钮",
    async (platform) => {
      mocks.platform = platform;
      mocks.settings["system.borderlessWindow"] = false;
      const service = await import("./main");
      service.createMainWindow();
      const options = mocks.createWindow.mock.calls.at(-1)?.[0];
      expect(options.frame).toBe(true);
      if (platform === "darwin") {
        expect(options).toEqual(
          expect.objectContaining({ titleBarStyle: "hidden", titleBarOverlay: { height: 32 } }),
        );
      } else {
        expect(options).not.toHaveProperty("titleBarStyle");
        expect(options).not.toHaveProperty("titleBarOverlay");
      }
    },
  );

  it("无边框模式保留现有窗口配置", async () => {
    mocks.settings["system.borderlessWindow"] = true;
    const service = await import("./main");
    service.createMainWindow();
    const options = mocks.createWindow.mock.calls.at(-1)?.[0];
    expect(options.frame).toBe(false);
    expect(options).not.toHaveProperty("titleBarStyle");
    expect(options).not.toHaveProperty("titleBarOverlay");
  });

  it("创建时设置缩放，导航重置后等首次绘制完成再校正", async () => {
    mocks.settings["system.uiZoom"] = 125;
    const service = await import("./main");
    service.createMainWindow();
    expect(mocks.main.loadFile).toHaveBeenCalledWith(expect.any(String), { hash: "/" });
    expect(mocks.createWindow).toHaveBeenCalledWith(
      expect.objectContaining({ webPreferences: expect.objectContaining({ zoomFactor: 1.25 }) }),
    );
    mocks.main.webContents.emit("did-finish-load");
    expect(mocks.main.webContents.setZoomFactor).not.toHaveBeenCalled();
    mocks.main.emit("ready-to-show");
    await service.showReadyMainWindow();
    expect(mocks.main.webContents.setZoomFactor).toHaveBeenCalledWith(1.25);
  });

  it("加载层就绪通知先到时等待窗口首次绘制", async () => {
    const service = await import("./main");
    service.createMainWindow();
    const shown = service.showReadyMainWindow();
    await flushPromises();
    expect(mocks.main.show).not.toHaveBeenCalled();
    mocks.main.emit("ready-to-show");
    await shown;
    expect(mocks.order).toEqual(["main-show"]);
  });

  it("窗口首次绘制不会代替加载层的就绪通知", async () => {
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.emit("ready-to-show");
    await flushPromises();
    service.focusMainWindow();
    expect(mocks.main.show).not.toHaveBeenCalled();
    await service.showReadyMainWindow();
    expect(mocks.order).toEqual(["main-show"]);
  });

  it("启用窗口状态持久化并以旧版几何作为迁移默认值", async () => {
    mocks.settings["windowStates.main"] = {
      width: 1600,
      height: 900,
      x: 120,
      y: 80,
      maximized: false,
    };
    const service = await import("./main");
    service.createMainWindow();
    expect(mocks.createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "main-window",
        windowStatePersistence: true,
        width: 1600,
        height: 900,
        x: 120,
        y: 80,
      }),
    );
  });

  it("关闭记忆窗口状态时不启用持久化也不使用旧版几何", async () => {
    mocks.settings["system.rememberWindowState"] = false;
    mocks.settings["windowStates.main"] = {
      width: 1600,
      height: 900,
      x: 120,
      y: 80,
      maximized: false,
    };
    const service = await import("./main");
    service.createMainWindow();
    const options = mocks.createWindow.mock.calls.at(-1)?.[0];
    expect(options).not.toHaveProperty("name");
    expect(options).not.toHaveProperty("windowStatePersistence");
    expect(options).toEqual(expect.objectContaining({ width: 1280, height: 800 }));
  });

  it("重复就绪通知只交接一次，交接后允许托盘重新显示窗口", async () => {
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.emit("ready-to-show");
    await Promise.all([service.showReadyMainWindow(), service.showReadyMainWindow()]);
    expect(mocks.order).toEqual(["main-show"]);
    service.focusMainWindow();
    expect(mocks.main.show).toHaveBeenCalledTimes(2);
    expect(mocks.main.focus).toHaveBeenCalledOnce();
  });

  it("等待首次绘制期间窗口销毁时不会显示窗口", async () => {
    const service = await import("./main");
    service.createMainWindow();
    const shown = service.showReadyMainWindow();
    mocks.main.isDestroyed = () => true;
    mocks.main.emit("ready-to-show");
    await expect(shown).rejects.toThrow("主窗口已关闭");
    expect(mocks.main.show).not.toHaveBeenCalled();
  });
});
