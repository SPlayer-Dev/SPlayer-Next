import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import type { NeteaseSong } from "@shared/types/platform/netease";
import { firstPlayableId, songToTrack, trackToNeteaseSong } from "./netease";

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

const track = (overrides: Partial<Track> = {}): Track => ({
  id: "123",
  source: "netease",
  title: "歌曲",
  artists: [],
  duration: 1_000,
  ...overrides,
});

describe("应用层 Track → NCM song", () => {
  it("还原桌面端 starPlaylist 需要的原始字段", () => {
    const song = trackToNeteaseSong(
      track({
        artists: [{ id: "7", name: "歌手" }, { name: "无名" }],
        album: { id: "9", name: "专辑", cover: "https://cover/300" },
        coverOriginal: "https://cover/1024",
        duration: 1_000,
        fee: 1,
      }),
    );

    expect(song).toEqual({
      id: 123,
      name: "歌曲",
      ar: [
        { id: 7, name: "歌手" },
        { id: 0, name: "无名" },
      ],
      al: { id: 9, name: "专辑", picUrl: "https://cover/1024" },
      dt: 1_000,
      fee: 1,
    });
  });

  it("缺少专辑时省略 al，并回退封面与免费标记", () => {
    const song = trackToNeteaseSong(track({ cover: "https://cover/300" }));

    expect(song.al).toBeUndefined();
    expect(song.fee).toBe(0);
  });
});

describe("firstPlayableId", () => {
  it("跳过仅购买曲目取第一首可播放曲目", () => {
    expect(firstPlayableId([track({ id: "a", fee: 4 }), track({ id: "b", fee: 1 })])).toBe("b");
  });

  it("没有可播放曲目时返回 undefined", () => {
    expect(firstPlayableId([track({ id: "a", fee: 4 })])).toBeUndefined();
    expect(firstPlayableId([])).toBeUndefined();
  });
});
