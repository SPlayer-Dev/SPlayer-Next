// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ invalidate: vi.fn(), resolve: vi.fn(), fetch: vi.fn() }));
vi.mock("./config", () => ({
  getStreamingServer: () => ({ id: "server", type: "jellyfin", revision: 0 }),
  getStreamingServerRevision: () => 0,
}));
vi.mock("./adapters/resolve", () => ({
  resolveStreamingAdapter: state.resolve,
  invalidateStreamingSession: state.invalidate,
}));
vi.mock("@main/utils/logger", () => ({ streamingLog: { warn: vi.fn() } }));
import { fetchStreamingDownload } from "./mediaSource";
beforeEach(() => {
  vi.clearAllMocks();
  state.resolve.mockImplementation(async (config) => ({
    config,
    adapter: { getDownloadUrl: async () => "https://server/Items/song/Download?ApiKey=secret" },
  }));
  vi.stubGlobal("fetch", state.fetch);
});
describe("流媒体原文件下载", () => {
  it("HTTP 200 的 Subsonic 错误体不能保存为音频", async () => {
    state.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          "subsonic-response": { status: "failed", error: { code: 50, message: "Not authorized" } },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      fetchStreamingDownload("server", "song", new AbortController().signal),
    ).rejects.toMatchObject({ code: 50 });
  });
  it("过大的错误体及时取消，避免把错误响应全部留在内存", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16384));
      },
      cancel,
    });
    state.fetch.mockResolvedValueOnce(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await expect(
      fetchStreamingDownload("server", "song", new AbortController().signal),
    ).rejects.toThrow("可下载的音频");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("旧账号曲目拒绝下载，不向新账号发送相同歌曲 ID", async () => {
    await expect(
      fetchStreamingDownload("server", "song", new AbortController().signal, 1),
    ).rejects.toThrow("重新选择歌曲");
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("下载响应保留原文件名，HTTP 401 只恢复一次鉴权", async () => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(
      new Response("RIFF", {
        headers: { "content-disposition": 'attachment; filename="song.wav"' },
      }),
    );
    const response = await fetchStreamingDownload("server", "song", new AbortController().signal);
    expect(await response.text()).toBe("RIFF");
    expect(response.headers.get("content-disposition")).toContain("song.wav");
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it("下载权限拒绝不重新登录或降级到播放端点", async () => {
    state.fetch.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      fetchStreamingDownload("server", "song", new AbortController().signal),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("取消任务时中断实际下载请求", async () => {
    const controller = new AbortController();
    state.fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
    );
    const request = fetchStreamingDownload("server", "song", controller.signal);
    await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
