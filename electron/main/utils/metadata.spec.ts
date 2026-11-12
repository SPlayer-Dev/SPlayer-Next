import { describe, expect, it } from "vitest";
import type { Artist, Track } from "@shared/types/player";
import { artistNames, resolveTrackMprisUrl } from "./metadata";

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

describe("resolveTrackMprisUrl", () => {
  it("正确解析网易云曲目 URL", () => {
    const track = { id: "123456", source: "netease" } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "")).toBe("https://music.163.com/song?id=123456");
  });

  it("正确解析 QQ 音乐曲目 URL（使用 songmid）", () => {
    const track = { id: "001XYZ", extId: "1000", source: "qqmusic" } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "")).toBe("https://y.qq.com/n/ryqq/songDetail/001XYZ");
  });

  it("正确解析酷狗曲目 URL", () => {
    const track = { id: "HASH123", source: "kugou" } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "")).toBe("https://www.kugou.com/song/#hash=HASH123");
  });

  it("正确解析本地普通曲目 URL（优先取 track.path 而非临时缓存 source）", () => {
    const track = { id: "1", source: "local", path: "/music/real.flac" } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "/tmp/cache.flac")).toBe("file:///music/real.flac");
  });

  it("正确解析本地 CUE 分轨曲目 URL（使用 cueAudioPath 避开虚拟路径）", () => {
    const track = {
      id: "cue-1",
      source: "local",
      cueAudioPath: "/music/album.flac",
      path: "cue:///music/album.cue#track=01",
    } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "/tmp/cache.flac")).toBe("file:///music/album.flac");
  });

  it("流媒体曲目返回 undefined（防止泄露凭据参数）", () => {
    const track = { id: "1", source: "streaming" } as unknown as Track;
    expect(
      resolveTrackMprisUrl(track, "https://media.server/stream?api_key=SECRET"),
    ).toBeUndefined();
  });

  it("独立插件曲目带有网络地址时正确解析", () => {
    const track = {
      id: "p1",
      source: "plugin",
      plugin: { source: "https://example.com/audio.mp3" },
    } as unknown as Track;
    expect(resolveTrackMprisUrl(track, "")).toBe("https://example.com/audio.mp3");
  });

  it("无权威曲目信息时对本地路径正常兜底，忽略网络源", () => {
    expect(resolveTrackMprisUrl(null, "/local/track.mp3")).toBe("file:///local/track.mp3");
    expect(resolveTrackMprisUrl(null, "https://stream.server/audio")).toBeUndefined();
  });
});
