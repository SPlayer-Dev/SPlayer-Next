import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  revision: 0,
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  stage: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock("@main/database", () => ({ isDbOpen: () => true }));
vi.mock("@main/database/streaming/tracks", () => ({ updateStreamingFavorite: state.update }));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: state.broadcast }));
vi.mock("./snapshot", () => ({ recordStreamingStageFavorite: state.stage }));
vi.mock("./config", () => ({ getStreamingServer: () => ({ revision: state.revision }) }));
vi.mock("./connection", () => ({
  withStreamingAdapter: async (_serverId, request) =>
    request({}, { getFavorite: state.get, setFavorite: state.set }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  state.revision = 0;
});

describe("流媒体收藏读写顺序", () => {
  it("同曲的旧读取、写入和后续读取依次确认，不让旧值覆盖写入", async () => {
    const { requestStreamingFavorite } = await import("./favorites");
    let finish!: (favorite: boolean) => void;
    let favorite = false;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.get.mockImplementation(async () => favorite);
    state.set.mockImplementation(async (_config, _trackId, value) => (favorite = value));
    const oldRead = requestStreamingFavorite("server", "song");
    const write = requestStreamingFavorite("server", "song", true);
    const newRead = requestStreamingFavorite("server", "song");
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce());
    expect(state.set).not.toHaveBeenCalled();
    finish(false);
    expect(await Promise.all([oldRead, write, newRead])).toEqual([false, true, true]);
    expect(state.update.mock.calls.map(([, , value]) => value)).toEqual([false, true, true]);
    expect(state.stage.mock.calls).toEqual(state.update.mock.calls);
    expect(state.broadcast.mock.calls.map(([, change]) => change.favorite)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("单曲失败不阻塞后续写入，结束后可以重新读取", async () => {
    const { requestStreamingFavorite } = await import("./favorites");
    state.get.mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue(true);
    state.set.mockResolvedValue(true);
    const failed = requestStreamingFavorite("server", "song");
    const write = requestStreamingFavorite("server", "song", true);
    await expect(failed).rejects.toThrow("读取失败");
    expect(await write).toBe(true);
    expect(await requestStreamingFavorite("server", "song")).toBe(true);
    expect(state.update).toHaveBeenCalledTimes(2);
  });
});
