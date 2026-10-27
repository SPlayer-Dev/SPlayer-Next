import type { Track } from "@shared/types/player";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchHeartModeList: vi.fn(),
  fetchMoreHeartModeSongs: vi.fn(),
}));

const user = vi.hoisted(() => ({
  likedPlaylistId: "liked-playlist" as string | null,
  likedPlaylistTracks: [] as Track[],
  likedSongIds: new Set<string>(),
  profile: null as { userId: number } | null,
}));

const status = vi.hoisted(() => ({
  heartMode: true,
  heartModeWantMore: true,
}));

const storage = vi.hoisted(() => ({
  getItem: vi.fn(() => Promise.resolve(null)),
  setItem: vi.fn(() => Promise.resolve()),
  removeItem: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/apis/recommend/netease", () => ({
  fetchHeartModeList: api.fetchHeartModeList,
  fetchMoreHeartModeSongs: api.fetchMoreHeartModeSongs,
}));

vi.mock("@/stores/user", () => ({
  useUserStore: () => user,
}));

vi.mock("@/stores/status", () => ({
  useStatusStore: () => status,
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: () => storage,
  },
}));

import { markPlayedOnce, queue, queueEntries, setQueue } from "@/stores/queue";
import { extendQueue } from "./heartMode";

const track = (id: string): Track => ({
  id,
  source: "netease",
  title: id,
  artists: [],
  duration: 1_000,
});

describe("heartMode", () => {
  beforeEach(() => {
    queueEntries.value = [];
    user.likedPlaylistId = "liked-playlist";
    user.likedPlaylistTracks = [track("a"), track("b")];
    user.likedSongIds = new Set(["a", "b"]);
    user.profile = { userId: 123 };
    status.heartMode = true;
    status.heartModeWantMore = true;
    api.fetchHeartModeList.mockReset();
    api.fetchMoreHeartModeSongs.mockReset();
  });

  it("优先使用更多推荐接口并只追加 3 首", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockResolvedValue({
      tracks: [track("b"), track("c"), track("d"), track("e")],
      algMap: { c: "Alg_C" },
    });

    await expect(extendQueue(track("a"))).resolves.toBe(3);

    expect(api.fetchMoreHeartModeSongs).toHaveBeenCalledWith(["a"], "a");
    expect(api.fetchHeartModeList).not.toHaveBeenCalled();
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(queue.value.find(({ id }) => id === "b")?.recommended).toBeUndefined();
    expect(queue.value.find(({ id }) => id === "b")?.moreRcmd).toBe(true);
    expect(queue.value.find(({ id }) => id === "c")?.algorithm).toBe("Alg_C");
  });

  it("关闭自动推荐后不发起续推请求", async () => {
    setQueue([track("a")]);
    status.heartModeWantMore = false;

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(api.fetchMoreHeartModeSongs).not.toHaveBeenCalled();
    expect(api.fetchHeartModeList).not.toHaveBeenCalled();
    expect(queue.value.map(({ id }) => id)).toEqual(["a"]);
  });

  it("请求期间关闭自动推荐时丢弃本批结果", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockImplementation(async () => {
      status.heartModeWantMore = false;
      return { tracks: [track("b")], algMap: {} };
    });

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a"]);
  });

  it("更多推荐接口失败时退回智能播放列表并携带桌面端参数", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockRejectedValue(new Error("404"));
    api.fetchHeartModeList.mockResolvedValue([track("b"), track("c"), track("d"), track("e")]);

    await expect(extendQueue(track("a"))).resolves.toBe(4);

    expect(api.fetchHeartModeList).toHaveBeenCalledWith(
      "a",
      "liked-playlist",
      expect.objectContaining({
        type: "fromPlayAll",
        count: 2,
        startMusicId: "a",
        uid: 123,
      }),
    );
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("回退智能播放列表时跳过仅购买曲目作为起始歌曲", async () => {
    setQueue([track("a")]);
    user.likedPlaylistTracks = [{ ...track("locked"), fee: 4 }, track("b")];
    api.fetchMoreHeartModeSongs.mockRejectedValue(new Error("404"));
    api.fetchHeartModeList.mockResolvedValue([track("b")]);

    await extendQueue(track("a"));

    expect(api.fetchHeartModeList).toHaveBeenCalledWith(
      "a",
      "liked-playlist",
      expect.objectContaining({ startMusicId: "b" }),
    );
  });

  it("两个接口都失败时返回 0 且不改动队列", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockRejectedValue(new Error("network"));
    api.fetchHeartModeList.mockRejectedValue(new Error("network"));

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a"]);
  });

  it("返回的曲目都在队列中时不追加", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockResolvedValue({
      tracks: [track("a")],
      algMap: {},
    });

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a"]);
  });

  it("没有喜欢的歌单且更多推荐不可用时不请求智能播放列表", async () => {
    setQueue([track("a")]);
    user.likedPlaylistId = null;
    api.fetchMoreHeartModeSongs.mockRejectedValue(new Error("404"));

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(api.fetchHeartModeList).not.toHaveBeenCalled();
  });

  it("请求期间正常切歌不会丢弃续推", async () => {
    setQueue([track("a"), track("b")]);
    api.fetchMoreHeartModeSongs.mockImplementation(async () => {
      markPlayedOnce(0);
      return { tracks: [track("c")], algMap: {} };
    });

    await expect(extendQueue(track("b"))).resolves.toBe(1);

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("请求期间退出心动模式时不追加队列", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockImplementation(async () => {
      status.heartMode = false;
      return { tracks: [track("b")], algMap: {} };
    });

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a"]);
  });

  it("请求期间队列被替换时不追加队列", async () => {
    setQueue([track("a")]);
    api.fetchMoreHeartModeSongs.mockImplementation(async () => {
      setQueue([track("x")]);
      return { tracks: [track("b")], algMap: {} };
    });

    await expect(extendQueue(track("a"))).resolves.toBe(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["x"]);
  });
});
