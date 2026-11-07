// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricManualMatch } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { clearManualMatch, getManualMatch, setManualMatch } from "./lyricManualMatch";

const track: Track = {
  id: "local-1",
  source: "local",
  title: "Song",
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
};

const pick: LyricManualMatch = {
  platform: "kugou",
  id: "hash",
  name: "别名",
  artist: "Artist",
  duration: 181_000,
};

describe("手动歌词选择", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE lyric_manual_match (
      track_key TEXT PRIMARY KEY, platform TEXT NOT NULL, platform_id TEXT NOT NULL,
      name TEXT NOT NULL, artist TEXT NOT NULL, duration INTEGER, picked_at INTEGER NOT NULL
    )`);
  });
  afterEach(() => state.db?.close());

  it("相同歌曲可跨来源读取，重选覆盖，清除后不再命中", () => {
    expect(getManualMatch(track)).toBeNull();

    setManualMatch(track, pick);
    expect(getManualMatch({ ...track, id: "1", source: "netease" })).toEqual(pick);

    setManualMatch(track, { ...pick, platform: "netease", id: "2" });
    expect(getManualMatch(track)).toMatchObject({ platform: "netease", id: "2" });

    clearManualMatch(track);
    expect(getManualMatch(track)).toBeNull();
  });
});
