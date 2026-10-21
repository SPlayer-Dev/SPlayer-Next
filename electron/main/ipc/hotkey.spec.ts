import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  suspend: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock("@main/services/globalHotkey", () => ({
  getHotkeyConfig: vi.fn(),
  setBinding: vi.fn(),
  resetBindings: vi.fn(),
  setGlobalEnabled: vi.fn(),
  probeAccelerator: vi.fn(),
  getConflicts: vi.fn(),
  setGlobalHotkeySuspended: mocks.suspend,
}));

import { registerHotkeyIpc } from "./hotkey";

describe("录入 IPC 的生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    registerHotkeyIpc();
  });

  it.each(["destroyed", "render-process-gone", "did-start-navigation"])(
    "录入页面发生 %s 时恢复快捷键并移除监听",
    (eventName) => {
      const sender = new EventEmitter();
      const invoke = mocks.handlers.get("hotkey:setRecording")!;
      invoke({ sender }, true);
      expect(mocks.suspend).toHaveBeenCalledWith(true);

      sender.emit(eventName);

      expect(mocks.suspend).toHaveBeenLastCalledWith(false);
      expect(sender.eventNames()).toEqual([]);
    },
  );

  it("只允许录入页面恢复注册，重复暂停不会累积监听", () => {
    const sender = new EventEmitter();
    const invoke = mocks.handlers.get("hotkey:setRecording")!;
    invoke({ sender }, true);
    invoke({ sender }, true);
    invoke({ sender: new EventEmitter() }, false);

    expect(mocks.suspend).toHaveBeenCalledExactlyOnceWith(true);
    expect(sender.listenerCount("destroyed")).toBe(1);

    invoke({ sender }, false);

    expect(mocks.suspend).toHaveBeenLastCalledWith(false);
    expect(sender.eventNames()).toEqual([]);
  });

  it("切换录入页面后旧页面销毁不会解除新页面的暂停", () => {
    const previous = new EventEmitter();
    const next = new EventEmitter();
    const invoke = mocks.handlers.get("hotkey:setRecording")!;
    invoke({ sender: previous }, true);
    invoke({ sender: next }, true);
    mocks.suspend.mockClear();

    previous.emit("destroyed");
    expect(mocks.suspend).not.toHaveBeenCalled();

    next.emit("destroyed");
    expect(mocks.suspend).toHaveBeenCalledExactlyOnceWith(false);
  });
});
