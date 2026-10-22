import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  sender: {},
  showReady: vi.fn(),
  showError: vi.fn(),
  quit: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getName: () => "SPlayer", quit: mocks.quit },
  dialog: { showErrorBox: mocks.showError },
  ipcMain: { handle: mocks.handle, on: mocks.on },
}));
vi.mock("@main/store", () => ({ store: { get: vi.fn() } }));
vi.mock("@main/utils/config", () => ({ isWin: false }));
vi.mock("@main/utils/logger", () => ({ coreLog: { error: mocks.logError } }));
vi.mock("@main/utils/powerBlocker", () => ({ setPlayerExpanded: vi.fn() }));
vi.mock("@main/window", () => ({
  getMainWindow: () => ({ webContents: mocks.sender }),
  showReadyMainWindow: mocks.showReady,
}));

import { registerWindowIpc } from "./window";

describe("启动窗口 IPC 职责", () => {
  const complete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    registerWindowIpc(complete);
  });

  it("就绪请求等待显示窗口，不启动后台任务或弹出错误", async () => {
    const ready = mocks.handle.mock.calls.find(([channel]) => channel === "window:ready")![1];
    const shown = Promise.resolve();
    mocks.showReady.mockReturnValue(shown);
    expect(ready({ sender: mocks.sender })).toBe(shown);
    await shown;
    expect(mocks.showReady).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("启动完成只通知应用核心调度后续任务", () => {
    const handler = mocks.handle.mock.calls.find(
      ([channel]) => channel === "window:startupComplete",
    )![1];
    handler({ sender: mocks.sender });
    expect(complete).toHaveBeenCalledOnce();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("其他窗口不能控制主窗口启动或触发致命错误退出", () => {
    for (const channel of ["window:ready", "window:startupComplete"]) {
      const handler = mocks.handle.mock.calls.find(([name]) => name === channel)![1];
      expect(() => handler({ sender: {} })).toThrow("窗口来源无效");
    }
    const failed = mocks.on.mock.calls.find(([channel]) => channel === "window:startupFailed")![1];
    failed({ sender: {} }, "加载失败");
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it("致命启动失败独立记录日志、提示并退出，不走就绪流程", () => {
    const failed = mocks.on.mock.calls.find(([channel]) => channel === "window:startupFailed")![1];
    failed({ sender: mocks.sender }, "加载失败");
    expect(mocks.logError).toHaveBeenCalledWith("渲染进程启动失败", "加载失败");
    expect(mocks.showError).toHaveBeenCalledWith("SPlayer", "加载失败");
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
