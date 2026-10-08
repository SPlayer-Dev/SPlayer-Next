import { describe, expect, it } from "vitest";
import type { NeteaseSong } from "@/types/netease";
import { songToTrack } from "./netease";

describe("网易云歌曲歌手格式化", () => {
  it.each(["ar", "artists"])("过滤 %s 中的空名称，保留有效歌手", (field) => {
    const song = {
      id: 325,
      name: "云盘歌曲",
      [field]: [{ id: 0, name: null }, { id: 1 }, { id: 2, name: " " }, { id: 3, name: " 歌手 " }],
    } as unknown as NeteaseSong;

    expect(songToTrack(song).artists).toEqual([{ id: "3", name: "歌手" }]);
  });

  it("歌手名称为空的云盘歌曲仍可生成播放信息", () => {
    const song = {
      id: 325,
      name: "云盘歌曲",
      ar: [{ id: 0, name: null }],
      pc: {},
    } as unknown as NeteaseSong;

    expect(songToTrack(song)).toMatchObject({
      id: "325",
      title: "云盘歌曲",
      artists: [],
      cloud: true,
    });
  });
});
