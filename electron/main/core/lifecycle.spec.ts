import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  app: null as any,
  quitting: false,
  order: [] as string[],
  stopServer: vi.fn(),
  stopMcpServer: vi.fn(),
  shutdownPlugins: vi.fn(),
  disposeBridge: vi.fn(),
  stopStreaming: vi.fn(),
  shutdownMedia: vi.fn(),
  disposeUpdater: vi.fn(),
  closeDatabase: vi.fn(),
}));

vi.mock("electron", () => ({ app: mocks.app }));
vi.mock("@main/services/media", () => ({ shutdown: mocks.shutdownMedia }));
vi.mock("@main/database", () => ({ closeDatabase: mocks.closeDatabase }));
vi.mock("@main/plugins/registry", () => ({
  pluginRegistry: { shutdown: mocks.shutdownPlugins },
}));
vi.mock("@main/plugins/playbackBridge", () => ({ dispose: mocks.disposeBridge }));
vi.mock("@main/server", () => ({ stopServer: mocks.stopServer }));
vi.mock("@main/services/mcp/http", () => ({ stopMcpServer: mocks.stopMcpServer }));
vi.mock("@main/services/streaming/playback", () => ({
  stopStreamingPlayback: mocks.stopStreaming,
}));
vi.mock("@main/services/updater", () => ({ disposeUpdater: mocks.disposeUpdater }));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => mocks.quitting }));

/** 造一个 Electron 风格的退出事件 */
const quitEvent = () => ({
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
});

beforeEach(() => {
  vi.resetModules();
  mocks.quitting = false;
  mocks.order = [];
  // electron 的 mock 在首次 import 时就捕获了 app 引用，这里复用同一个实例并清空监听
  if (!mocks.app) {
    mocks.app = Object.assign(new EventEmitter(), { quit: vi.fn(), exit: vi.fn() });
  } else {
    mocks.app.removeAllListeners();
  }

  const record = (fn: typeof mocks.stopServer, name: string): void => {
    fn.mockImplementation(() => void mocks.order.push(name));
  };
  record(mocks.stopServer, "外部 API");
  record(mocks.stopMcpServer, "MCP");
  record(mocks.shutdownPlugins, "插件");
  record(mocks.disposeBridge, "播放事件桥");
  record(mocks.stopStreaming, "流媒体播放会话");
  record(mocks.shutdownMedia, "系统媒体");
  record(mocks.disposeUpdater, "更新服务");
  record(mocks.closeDatabase, "数据库");
});

describe("应用退出流程", () => {
  it("先按依赖顺序清理，清理完成后才真正退出", async () => {
    const { initAppLifecycle } = await import("./lifecycle");
    initAppLifecycle();

    const event = quitEvent();
    mocks.app.emit("before-quit", event);

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.app.quit).not.toHaveBeenCalled();

    await flushPromises();

    expect(mocks.order).toEqual([
      "外部 API",
      "MCP",
      "插件",
      "播放事件桥",
      "流媒体播放会话",
      "系统媒体",
      "更新服务",
      "数据库",
    ]);
    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  });

  it("清理期间重复触发退出不会重复清理", async () => {
    const { initAppLifecycle } = await import("./lifecycle");
    initAppLifecycle();

    mocks.app.emit("before-quit", quitEvent());
    mocks.app.emit("before-quit", quitEvent());
    await flushPromises();

    expect(mocks.stopServer).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("退出流程中关掉最后一个窗口后补一次退出调用", async () => {
    const { initAppLifecycle } = await import("./lifecycle");
    initAppLifecycle();

    // 退出时 Electron 会把内部退出标记复位，关窗后只剩余 window-all-closed
    mocks.quitting = true;
    mocks.app.emit("window-all-closed");

    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  });
});
