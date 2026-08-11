import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const api = vi.hoisted(() => ({
  fetchAlbum: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchPodcastDetail: vi.fn(),
  fetchPodcastPrograms: vi.fn(),
}));

vi.mock("@/apis/album/netease", () => ({ fetchAlbum: api.fetchAlbum }));
vi.mock("@/apis/playlist/netease", () => ({ fetchPlaylist: api.fetchPlaylist }));
vi.mock("@/apis/podcast/netease", () => ({
  fetchPodcastDetail: api.fetchPodcastDetail,
  fetchPodcastPrograms: api.fetchPodcastPrograms,
}));

import { loadNeteaseCollection } from "./netease";

const track: Track = {
  id: "1",
  extId: "2",
  source: "netease",
  title: "测试声音",
  artists: [],
  duration: 60000,
};

describe("网易云播客集合加载", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    api.fetchPodcastDetail.mockResolvedValue({
      id: 10,
      name: "测试播客",
      programCount: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("元数据声明有节目但第一页为空时自动重试", async () => {
    api.fetchPodcastPrograms
      .mockResolvedValueOnce({ items: [], total: 0, hasMore: false })
      .mockResolvedValueOnce({ items: [track], total: 1, hasMore: false });
    const onUpdate = vi.fn();

    const loading = loadNeteaseCollection("radio", "10", { onUpdate });
    await vi.advanceTimersByTimeAsync(300);
    await loading;

    expect(api.fetchPodcastPrograms).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tracks: [track],
      }),
    );
  });

  it("重试后仍为空时抛出错误而不是报告空播客", async () => {
    api.fetchPodcastPrograms.mockResolvedValue({ items: [], total: 0, hasMore: false });

    const loading = loadNeteaseCollection("radio", "10", { onUpdate: vi.fn() });
    const rejected = expect(loading).rejects.toThrow(
      "podcast programs returned an unexpected empty page",
    );
    await vi.advanceTimersByTimeAsync(300);

    await rejected;
  });

  it("初次进入只加载首屏节目", async () => {
    api.fetchPodcastPrograms.mockResolvedValue({
      items: [track],
      total: 120,
      hasMore: true,
    });
    const onUpdate = vi.fn();

    await loadNeteaseCollection("radio", "10", { onUpdate });

    expect(api.fetchPodcastPrograms).toHaveBeenCalledTimes(1);
    expect(api.fetchPodcastPrograms).toHaveBeenCalledWith("10", 0);
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tracks: [track],
        trackCount: 120,
      }),
    );
  });
});
