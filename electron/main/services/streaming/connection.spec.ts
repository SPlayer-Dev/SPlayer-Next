import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingRequestError } from "./errors";
const state = vi.hoisted(() => ({ revision: 0, resolve: vi.fn(), invalidate: vi.fn() }));
vi.mock("./config", () => ({
  getStreamingServer: () => ({ id: "server", type: "jellyfin", revision: state.revision }),
  getStreamingServerRevision: () => state.revision,
}));
vi.mock("./adapters/resolve", () => ({
  resolveStreamingAdapter: state.resolve,
  invalidateStreamingSession: state.invalidate,
}));
vi.mock("@main/utils/logger", () => ({ streamingLog: { warn: vi.fn() } }));
import { withStreamingAdapter } from "./connection";
beforeEach(() => {
  state.revision = 0;
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
});
