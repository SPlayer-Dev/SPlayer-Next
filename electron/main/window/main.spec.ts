import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  main: null as any,
  order: [] as string[],
  settings: {} as Record<string, unknown>,
  createWindow: vi.fn(),
  quitting: false,
  isMac: true,
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
  handleCacheProtocol: vi.fn(),
}));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => mocks.quitting }));
vi.mock("@main/utils/config", () => ({
  get isMac() {
    return mocks.isMac;
  },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  mocks.quitting = false;
  mocks.isMac = true;
  mocks.order = [];
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
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(() => {
      mocks.order.push("main-show");
      mocks.main.emit("show");
    }),
    focus: vi.fn(),
  });
  mocks.createWindow.mockClear();
  mocks.createWindow.mockImplementation(() => mocks.main);
});

describe("隐藏主窗口", () => {
  it("合并全屏进入期间的隐藏和系统关闭，在退出全屏后隐藏一次", async () => {
    const service = await import("./main");
    const win = service.createMainWindow();
    service.toggleFullscreenMainWindow();
    service.hideMainWindow();
    const preventDefault = vi.fn();
    win.emit("close", { preventDefault });
    win.emit("enter-full-screen");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.main.setFullScreen.mock.calls).toEqual([[true], [false]]);
    expect(mocks.main.hide).not.toHaveBeenCalled();
    win.emit("leave-full-screen");
    expect(mocks.main.hide).toHaveBeenCalledOnce();
  });

  it("全屏退出期间唤起窗口会取消待执行的隐藏", async () => {
    const service = await import("./main");
    const win = service.createMainWindow();
    win.emit("ready-to-show");
    await service.showReadyMainWindow();
    win.emit("enter-full-screen");
    service.hideMainWindow();
    service.focusMainWindow();
    win.emit("leave-full-screen");
    expect(mocks.main.focus).toHaveBeenCalledOnce();
    expect(mocks.main.hide).not.toHaveBeenCalled();
  });

  it("全屏退出期间结束应用时放行系统关闭", async () => {
    const service = await import("./main");
    const win = service.createMainWindow();
    mocks.main.isFullScreen.mockReturnValue(true);
    service.hideMainWindow();
    mocks.quitting = true;
    const preventDefault = vi.fn();
    win.emit("close", { preventDefault });
    win.emit("leave-full-screen");
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.main.hide).not.toHaveBeenCalled();
  });

  it.each([
    [true, false],
    [false, true],
  ])("直接隐藏无需等待原生过渡的窗口（macOS=%s，全屏=%s）", async (mac, fullscreen) => {
    mocks.isMac = mac;
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.isFullScreen.mockReturnValue(fullscreen);
    service.hideMainWindow();
    expect(mocks.main.hide).toHaveBeenCalledOnce();
    expect(mocks.main.setFullScreen).not.toHaveBeenCalled();
  });
});

describe("主窗口启动交接", () => {
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
    mocks.main.emit("closed");
    await expect(shown).rejects.toThrow("主窗口已关闭");
    expect(mocks.main.show).not.toHaveBeenCalled();
  });

  it("退出时关闭未完成首次绘制的窗口，结束显示请求", async () => {
    const service = await import("./main");
    service.createMainWindow();
    const shown = service.showReadyMainWindow();
    mocks.quitting = true;
    mocks.main.isDestroyed = () => true;
    mocks.main.emit("closed");
    await shown;
    expect(mocks.main.show).not.toHaveBeenCalled();
  });

  it("退出期间忽略对已就绪窗口的唤起", async () => {
    const service = await import("./main");
    service.createMainWindow();
    mocks.main.emit("ready-to-show");
    await service.showReadyMainWindow();
    mocks.quitting = true;
    service.focusMainWindow();
    expect(mocks.main.show).toHaveBeenCalledOnce();
    expect(mocks.main.focus).not.toHaveBeenCalled();
  });
});
