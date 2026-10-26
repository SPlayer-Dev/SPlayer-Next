import { describe, expect, it } from "vitest";
import type { NeteaseSong } from "@shared/types/platform/netease";
import { songToTrack } from "./netease";

describe("NCM歌曲歌手格式化", () => {
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

describe("NCM 专辑分碟信息", () => {
  it("保留碟片完整名称和平台曲序", () => {
    expect(
      songToTrack({
        id: 1970550394,
        name: "GLORIA",
        cd: " 2 天堂的回信 Letters from Heaven ",
        no: 8,
      }),
    ).toMatchObject({
      disc: "2 天堂的回信 Letters from Heaven",
      track: 8,
    });
  });

  it("缺失或空白碟号保持未指定，无效曲序不作为零号显示", () => {
    expect(songToTrack({ id: 1, name: "单曲", cd: " ", no: 0 })).toMatchObject({
      disc: undefined,
      track: undefined,
    });
    expect(songToTrack({ id: 2, name: "旧接口歌曲" })).toMatchObject({
      disc: undefined,
      track: undefined,
    });
  });
});
