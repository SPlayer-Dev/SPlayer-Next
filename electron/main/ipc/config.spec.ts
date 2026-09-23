// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 配置写入入口的通道同步测试
 * 覆盖率的关键在于「入口是否调用同步」，而不是在测试里直接调用 syncChannel：
 * 若删除 config:set / config:reset / config:replaceAll 中的同步调用，这些用例必须失败
 */
const hoisted = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  const state: Record<string, unknown> = { "update.channel": "stable" };

  /** syncChannel 被调用瞬间读到的有效通道，用于验证「先写入、再同步」的契约 */
  const syncedChannels: unknown[] = [];

  return {
    handlers,
    state,
    syncedChannels,
    applyChannelChange: vi.fn(),
    /** 记录同步时观察到的通道，而不是只统计调用次数 */
    syncChannel: vi.fn(() => {
      syncedChannels.push(state["update.channel"]);
      return true;
    }),
    replaceAll: vi.fn(),
    clear: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => {
      hoisted.handlers.set(name, handler);
    },
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
}));
vi.mock("node:fs/promises", () => ({
  default: { writeFile: vi.fn(), readFile: vi.fn() },
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => hoisted.state[key],
    // 写父对象时同时落到扁平键，模拟真实 store 的 dot-path 语义，
    // 否则入口测试无法验证「同步时读到的是写入后的值」
    set: (key: string, value: unknown) => {
      if (key === "update" && value !== null && typeof value === "object") {
        hoisted.state["update.channel"] = (value as Record<string, unknown>).channel;
      }
      hoisted.state[key] = value;
    },
    get store() {
      return hoisted.state;
    },
    clear: hoisted.clear.mockImplementation(() => {
      hoisted.state["update.channel"] = "stable";
    }),
    replaceAll: hoisted.replaceAll.mockImplementation((payload: unknown) => {
      const update = (payload as Record<string, unknown> | null)?.update;
      if (update !== null && typeof update === "object" && "channel" in update) {
        hoisted.state["update.channel"] = (update as Record<string, unknown>).channel;
      }
      hoisted.state.replaceAllPayload = payload;
    }),
  },
}));
vi.mock("@main/services/updater", () => ({
  applyChannelChange: hoisted.applyChannelChange,
  syncChannel: hoisted.syncChannel,
}));
vi.mock("@main/utils/logger", () => ({
  systemLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/services/media", () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  reloadDiscordConfig: vi.fn(),
}));
vi.mock("@main/services/lastfm", () => ({ reloadConfig: vi.fn() }));
vi.mock("@main/services/engine", () => ({
  setNormalizationEnabled: vi.fn(),
  setEqualizerEnabled: vi.fn(),
  setEqualizerBands: vi.fn(),
  setPreampGain: vi.fn(),
  // config.ts 会按 player.audioOutputMode 写入调用，缺失导出会在用例里变成 not a function
  setExclusiveMode: vi.fn(),
}));
vi.mock("@main/window", () => ({
  setTaskbarProgress: vi.fn(),
  applyMainWindowZoom: vi.fn(),
  applyDesktopLyricLock: vi.fn(),
  applyDesktopLyricAlwaysOnTop: vi.fn(),
  applyDynamicIslandAlwaysOnTop: vi.fn(),
  applyDynamicIslandSnapCentered: vi.fn(),
  applyDynamicIslandNotchFusion: vi.fn(),
  applyDynamicIslandNonOcclusive: vi.fn(),
  applyTaskbarLyricLayout: vi.fn(),
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/config", () => ({ isWin: true }));
vi.mock("@main/server", () => ({ startServer: vi.fn(), stopServer: vi.fn() }));
vi.mock("@main/services/mcp/http", () => ({
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
}));
vi.mock("@main/services/orpheus", () => ({ setOrpheusProtocolRegistered: vi.fn() }));
vi.mock("@main/services/thumbnail", () => ({ setTaskbarThumbnailEnabled: vi.fn() }));

import { registerConfigIpc } from "./config";

/** 调用已注册的 IPC handler（首个参数是 event，这里传空对象） */
const call = (name: string, ...args: unknown[]): unknown => {
  const handler = hoisted.handlers.get(name);
  if (!handler) throw new Error(`未注册的 IPC handler: ${name}`);
  return handler({}, ...args);
};

describe("配置写入入口的通道同步", () => {
  beforeEach(() => {
    hoisted.handlers.clear();
    hoisted.state["update.channel"] = "stable";
    hoisted.syncedChannels.length = 0;
    vi.clearAllMocks();
    registerConfigIpc();
  });

  it("单独写入通道会应用通道变更并同步失效", () => {
    call("config:set", "update.channel", "nightly");

    expect(hoisted.applyChannelChange).toHaveBeenCalledWith("stable", "nightly");
    expect(hoisted.syncChannel).toHaveBeenCalledTimes(1);
  });

  it("写入 update 父对象时同步发生在写入之后", () => {
    // 父对象写入不匹配 update.channel 分支，必须靠入口统一的同步兜住；
    // 断言同步瞬间读到的已是新值，否则「先同步后写入」的错误实现也能通过
    call("config:set", "update", { channel: "beta", autoCheck: true });

    expect(hoisted.syncedChannels).toEqual(["beta"]);
  });

  it("单独写入通道时同步发生在写入之后", () => {
    call("config:set", "update.channel", "nightly");

    expect(hoisted.syncedChannels).toEqual(["nightly"]);
  });

  it("普通配置写入也会经过同步（由 syncChannel 自行判定是否变化）", () => {
    call("config:set", "locale", "en-US");

    expect(hoisted.syncChannel).toHaveBeenCalledTimes(1);
    expect(hoisted.syncedChannels).toEqual(["stable"]);
  });

  it("config:reset 先清空再同步", () => {
    // 从非默认通道开始，否则重置前后的通道没有差异，无法验证时序
    hoisted.state["update.channel"] = "nightly";

    call("config:reset");

    expect(hoisted.clear).toHaveBeenCalledTimes(1);
    expect(hoisted.syncedChannels).toEqual(["stable"]);
  });

  it("config:replaceAll 先写入再同步", () => {
    const payload = { update: { channel: "alpha" } };
    hoisted.state["update.channel"] = "nightly";

    call("config:replaceAll", payload);

    expect(hoisted.replaceAll).toHaveBeenCalledWith(payload);
    expect(hoisted.syncedChannels).toEqual(["alpha"]);
  });

  it("非法通道被拒绝，且不写入也不同步", () => {
    expect(() => call("config:set", "update.channel", "bogus")).toThrow(/无效的更新通道/);
    expect(hoisted.syncChannel).not.toHaveBeenCalled();
    expect(hoisted.state["update.channel"]).toBe("stable");
  });

  it("四个合法通道都被接受", () => {
    for (const channel of ["stable", "beta", "alpha", "nightly"]) {
      expect(() => call("config:set", "update.channel", channel)).not.toThrow();
    }
  });

  it("空值与非字符串通道被拒绝", () => {
    for (const value of [null, undefined, "", 1, {}]) {
      expect(() => call("config:set", "update.channel", value)).toThrow(/无效的更新通道/);
    }
    expect(hoisted.syncChannel).not.toHaveBeenCalled();
  });
});
