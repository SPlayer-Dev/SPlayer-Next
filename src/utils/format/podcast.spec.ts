import { describe, expect, it } from "vitest";
import type { NeteaseDjProgram, NeteaseDjRadio } from "@/types/netease";
import { podcastProgramToTrack, podcastToCoverItem, toPodcast } from "./podcast";

const radio: NeteaseDjRadio = {
  id: 10,
  name: "测试播客",
  picUrl: "https://example.com/radio.jpg",
  desc: "简介",
  dj: { userId: 2, nickname: "主播" },
  programCount: 3,
};

describe("网易云播客格式转换", () => {
  it("将播客转换为封面摘要", () => {
    const podcast = toPodcast(radio);

    expect(podcast).toMatchObject({
      id: "10",
      name: "测试播客",
      creator: "主播",
      programCount: 3,
    });
    expect(podcastToCoverItem(podcast)).toMatchObject({
      id: "10",
      title: "测试播客",
      trackCount: 3,
    });
  });

  it("使用节目主歌曲 ID 生成可播放曲目", () => {
    const program: NeteaseDjProgram = {
      id: 20,
      categoryId: 7,
      name: "第一期",
      duration: 123000,
      createTime: 1710000000000,
      listenerCount: 1234,
      likedCount: 56,
      coverUrl: "https://example.com/program.jpg",
      radio,
      dj: radio.dj,
      mainSong: {
        id: 30,
        name: "原始声音",
        dt: 120000,
        ar: [],
      },
    };

    const track = podcastProgramToTrack(program);

    expect(track).toMatchObject({
      id: "30",
      extId: "20",
      playbackSource: { id: "10", type: "radio", categoryId: 7 },
      source: "netease",
      title: "第一期",
      duration: 123000,
      publishTime: 1710000000000,
      playCount: 1234,
      likedCount: 56,
      artists: [{ name: "主播" }],
      album: { id: "10", name: "测试播客" },
    });
    expect(track.cover).toBe("https://example.com/program.jpg?param=300y300");
  });
});
