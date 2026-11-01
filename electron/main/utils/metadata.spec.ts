import { describe, expect, it } from "vitest";
import type { Artist } from "@shared/types/player";
import { artistNames } from "./metadata";

describe("播放元数据歌手名称", () => {
  it("兼容缓存中空名称的云盘歌手，并保留有效名称", () => {
    const artists = [{ name: null }, {}, { name: " " }, { name: " 歌手 " }] as unknown as Artist[];

    expect(artistNames(artists)).toEqual(["歌手"]);
  });

  it("无有效歌手时返回空数组", () => {
    expect(artistNames([])).toEqual([]);
    expect(artistNames([{ name: null }] as unknown as Artist[])).toEqual([]);
  });
});
