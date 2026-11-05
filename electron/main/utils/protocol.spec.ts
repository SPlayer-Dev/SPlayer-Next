import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /**
   * 模拟 Electron 在同一会话中拒绝重复注册协议
   * @returns 具有独立注册状态的协议对象
   */
  const makeProtocol = () => {
    const schemes = new Set<string>();
    return {
      isProtocolHandled: (scheme: string) => schemes.has(scheme),
      handle: vi.fn((scheme: string) => {
        if (schemes.has(scheme)) throw new Error("协议已注册");
        schemes.add(scheme);
      }),
    };
  };
  return { defaultProtocol: makeProtocol(), mainProtocol: makeProtocol() };
});

vi.mock("electron", () => ({
  protocol: mocks.defaultProtocol,
  session: { fromPartition: () => ({ protocol: mocks.mainProtocol }) },
}));
vi.mock("./config", () => ({ getAppCacheDir: vi.fn() }));

import { handleCacheProtocol, MAIN_PARTITION } from "./protocol";

describe("缓存协议注册", () => {
  it("主窗口重建时复用分区处理器，两个会话可独立注册", () => {
    handleCacheProtocol();
    handleCacheProtocol(MAIN_PARTITION);
    handleCacheProtocol(MAIN_PARTITION);
    handleCacheProtocol();
    expect(mocks.defaultProtocol.handle).toHaveBeenCalledExactlyOnceWith(
      "cache",
      expect.any(Function),
    );
    expect(mocks.mainProtocol.handle).toHaveBeenCalledExactlyOnceWith(
      "cache",
      expect.any(Function),
    );
  });
});
