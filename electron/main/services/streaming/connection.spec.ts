import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingCredentialError, StreamingRequestError } from "./errors";
const state = vi.hoisted(() => ({
  revision: 0,
  resolve: vi.fn(),
  invalidate: vi.fn(),
  createTest: vi.fn(),
  serverError: null as Error | null,
}));
vi.mock("./config", () => ({
  getStreamingServer: () => {
    if (state.serverError) throw state.serverError;
    return { id: "server", type: "jellyfin", revision: state.revision };
  },
  getStreamingServerRevision: () => state.revision,
  createTestStreamingServer: state.createTest,
  markStreamingServerConnected: () => ({ id: "server" }),
}));
vi.mock("./adapters/resolve", () => ({
  resolveStreamingAdapter: state.resolve,
  invalidateStreamingSession: state.invalidate,
}));
vi.mock("@main/utils/logger", () => ({ streamingLog: { warn: vi.fn(), info: vi.fn() } }));
import {
  connectStreamingServer,
  testStreamingConnection,
  withStreamingAdapter,
} from "./connection";
beforeEach(() => {
  state.revision = 0;
  state.serverError = null;
  state.createTest.mockReset();
  state.resolve.mockReset().mockImplementation(async (config) => ({ config, adapter: {} }));
  state.invalidate.mockClear();
});

describe("流媒体会话恢复", () => {
  it("401 只重新登录并重试一次", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new StreamingRequestError("expired", 401))
      .mockResolvedValueOnce("ok");
    expect(await withStreamingAdapter("server", request)).toBe("ok");
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("403 权限拒绝不会重复登录", async () => {
    const request = vi.fn().mockRejectedValue(new StreamingRequestError("forbidden", 403));
    await expect(withStreamingAdapter("server", request)).rejects.toMatchObject({ status: 403 });
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("鉴权期间修改配置不会向旧服务器执行写操作", async () => {
    state.resolve.mockImplementationOnce(async (config) => {
      state.revision++;
      return { config, adapter: {} };
    });
    const request = vi.fn();
    await expect(withStreamingAdapter("server", request)).rejects.toThrow("已作废");
    expect(request).not.toHaveBeenCalled();
  });
  it("配置更新后迟到请求作废", async () => {
    await expect(
      withStreamingAdapter("server", async () => {
        state.revision++;
        return true;
      }),
    ).rejects.toThrow("已作废");
  });
  it("测试连接遇到本地凭据解密失败返回 credential", async () => {
    state.createTest.mockRejectedValue(
      new StreamingCredentialError("无法解密流媒体密码，请在服务器设置中重新输入密码"),
    );
    const result = await testStreamingConnection({
      name: "测试",
      type: "navidrome",
      url: "https://server",
      username: "user",
      password: "",
    });
    expect(result).toMatchObject({ ok: false, code: "credential" });
    expect(result.error).toContain("重新输入密码");
  });
  it("连接时本地凭据解密失败返回 credential", async () => {
    state.serverError = new StreamingCredentialError(
      "无法解密流媒体密码，请在服务器设置中重新输入密码",
    );
    const result = await connectStreamingServer("server");
    expect(result).toMatchObject({ ok: false, code: "credential" });
  });
});
