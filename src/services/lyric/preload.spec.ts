import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mockResolveLyricForPreload = vi.fn();

vi.mock("./resolve", () => ({
  resolveLyricForPreload: (...args: unknown[]) => mockResolveLyricForPreload(...args),
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ lyric: {}, system: { lyric: {}, localLyric: {} } }),
}));

vi.mock("@/stores/streaming", () => ({
  useStreamingStore: () => ({ activeServerId: null }),
}));

vi.mock("@/stores/plugins", () => ({
  usePluginsStore: () => ({ list: [] }),
}));

import { consumePreloadedLyric, preloadLyricForTrack } from "./preload";

const track: Track = {
  id: "song",
  source: "netease",
  title: "Song",
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
};

describe("consumePreloadedLyric", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("预载尚未完成时不等待，并取消预载", async () => {
    mockResolveLyricForPreload.mockReturnValue(new Promise(() => {}));
    preloadLyricForTrack(track);

    expect(consumePreloadedLyric(track)).toEqual({ hit: false });
    expect(mockResolveLyricForPreload.mock.calls[0][1]()).toBe(false);
  });

  it("预载已完成时返回结果", async () => {
    const lyric = { source: { source: "online", format: "lrc" }, input: { content: "x" } };
    mockResolveLyricForPreload.mockResolvedValue(lyric);
    preloadLyricForTrack(track);
    await new Promise((resolve) => setTimeout(resolve));

    expect(consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
  });
});
