import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSummary } from "@shared/types/playlist";

const legacyStorage = vi.hoisted(() => ({
  records: [] as unknown[],
  clear: vi.fn(() => Promise.resolve()),
  iterate: vi.fn(async (callback: (record: unknown) => void) => {
    legacyStorage.records.forEach(callback);
  }),
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: () => legacyStorage,
  },
}));

import { usePlaylistStore } from "./playlist";

const summary = (id: string): PlaylistSummary => ({
  id,
  type: "local",
  title: id,
  trackCount: 0,
  createTime: 1,
  updateTime: 1,
});

describe("playlist store", () => {
  const playlistApi = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addTracks: vi.fn(),
    removeTracks: vi.fn(),
    importLegacy: vi.fn(),
    clear: vi.fn(),
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    legacyStorage.records = [];
    legacyStorage.clear.mockClear();
    Object.values(playlistApi).forEach((mock) => mock.mockReset());
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { playlist: playlistApi },
    });
  });

  it("加载时导入旧歌单并返回本地列表", async () => {
    legacyStorage.records = [
      {
        id: "legacy",
        title: "旧歌单",
        trackIds: ["track-1"],
        createTime: 1,
        updateTime: 2,
      },
    ];
    playlistApi.importLegacy.mockResolvedValue(undefined);
    playlistApi.list.mockResolvedValue([summary("local")]);

    const store = usePlaylistStore();
    await store.load();

    expect(playlistApi.importLegacy).toHaveBeenCalledWith([
      expect.objectContaining({ id: "legacy", trackIds: ["track-1"] }),
    ]);
    expect(legacyStorage.clear).toHaveBeenCalledOnce();
    expect(store.playlists.map(({ type }) => type)).toEqual(["local"]);
    expect(store.localPlaylists.map(({ id }) => id)).toEqual(["local"]);
  });

  it("将本地歌单转换为现有 Collection", async () => {
    playlistApi.get.mockResolvedValueOnce({ ...summary("local"), tracks: [] });

    const store = usePlaylistStore();
    await expect(store.get("local")).resolves.toMatchObject({
      id: "local",
      type: "playlist",
      source: "local",
    });
  });
});
