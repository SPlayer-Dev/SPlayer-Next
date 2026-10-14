import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HotkeyConfig } from "@shared/types/hotkey";
import { defaultHotkeyConfig } from "@shared/defaults/hotkeys";

const mocks = vi.hoisted(() => ({
  config: {} as HotkeyConfig,
  registered: new Map<string, () => void>(),
  register: vi.fn(),
  unregisterAll: vi.fn(),
  set: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  globalShortcut: {
    register: mocks.register,
    unregisterAll: mocks.unregisterAll,
    unregister: (accelerator: string) => mocks.registered.delete(accelerator),
    isRegistered: (accelerator: string) => mocks.registered.has(accelerator),
  },
}));
vi.mock("@main/store", () => ({
  store: { get: () => mocks.config, set: mocks.set },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));

describe("录入期间暂停全局快捷键", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.registered.clear();
    mocks.config = {
      ...defaultHotkeyConfig,
      bindings: {
        ...defaultHotkeyConfig.bindings,
        "player.prev": { inApp: "CommandOrControl+Left", global: "CommandOrControl+Alt+num3" },
        "player.next": { inApp: "CommandOrControl+Right", global: "CommandOrControl+Alt+num1" },
      },
    };
    mocks.register.mockImplementation((accelerator: string, callback: () => void) => {
      if (mocks.registered.has(accelerator)) return false;
      mocks.registered.set(accelerator, callback);
      return true;
    });
    mocks.unregisterAll.mockImplementation(() => mocks.registered.clear());
    mocks.set.mockImplementation((_key: string, config: HotkeyConfig) => {
      mocks.config = config;
    });
  });

  it("解除注册但不修改总开关，结束录入后恢复", async () => {
    const service = await import("./globalHotkey");
    service.initGlobalHotkey();
    expect(mocks.registered.has("CommandOrControl+Alt+num3")).toBe(true);

    service.setGlobalHotkeySuspended(true);

    expect(mocks.registered.size).toBe(0);
    expect(mocks.config.globalEnabled).toBe(true);
    expect(mocks.set).not.toHaveBeenCalled();

    service.setGlobalHotkeySuspended(false);

    expect(mocks.registered.has("CommandOrControl+Alt+num3")).toBe(true);
    expect(mocks.registered.has("CommandOrControl+Alt+num1")).toBe(true);
  });

  it("录入中保存新绑定仍保持暂停，恢复时使用最新配置", async () => {
    const service = await import("./globalHotkey");
    service.initGlobalHotkey();
    service.setGlobalHotkeySuspended(true);
    service.setBinding("player.prev", { inApp: null, global: "CommandOrControl+Alt+num5" });

    expect(mocks.registered.size).toBe(0);
    expect(mocks.config.globalEnabled).toBe(true);

    service.setGlobalHotkeySuspended(false);

    expect(mocks.registered.has("CommandOrControl+Alt+num5")).toBe(true);
    expect(mocks.registered.has("CommandOrControl+Alt+num3")).toBe(false);
  });

  it("暂停前排队的回调在暂停中和恢复后都不会执行旧动作", async () => {
    const service = await import("./globalHotkey");
    service.initGlobalHotkey();
    const staleCallback = mocks.registered.get("CommandOrControl+Alt+num3")!;
    service.setGlobalHotkeySuspended(true);
    mocks.broadcast.mockClear();

    staleCallback();
    expect(mocks.broadcast).not.toHaveBeenCalled();

    service.setGlobalHotkeySuspended(false);
    mocks.broadcast.mockClear();
    staleCallback();
    expect(mocks.broadcast).not.toHaveBeenCalled();

    mocks.registered.get("CommandOrControl+Alt+num3")!();
    expect(mocks.broadcast).toHaveBeenCalledWith("hotkey:trigger", "player.prev");
  });

  it("总开关原本关闭时，结束录入不会重新启用", async () => {
    const service = await import("./globalHotkey");
    mocks.config.globalEnabled = false;
    service.initGlobalHotkey();
    service.setGlobalHotkeySuspended(true);
    service.setGlobalHotkeySuspended(false);

    expect(mocks.registered.size).toBe(0);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.config.globalEnabled).toBe(false);
  });

  it("暂停期间仍可探测新绑定，并在探测后解除临时注册", async () => {
    const service = await import("./globalHotkey");
    service.initGlobalHotkey();
    service.setGlobalHotkeySuspended(true);

    expect(service.probeAccelerator("CommandOrControl+Alt+num5")).toBe(true);
    expect(mocks.registered.size).toBe(0);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
