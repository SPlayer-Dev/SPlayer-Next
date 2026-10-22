import { beforeEach, describe, expect, it, vi } from "vitest";
import { subsonicAdapter } from "./subsonic";
import { jellyfinAdapter } from "./jellyfin";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import type { Track } from "@shared/types/player";
import { StreamingRequestError } from "../errors";

const config: StreamingRuntimeConfig = {
  id: "server",
  name: "测试服务器",
  type: "jellyfin",
  url: "https://server/prefix",
  username: "user",
  password: "password",
  hasPassword: true,
  userId: "user-id",
  accessToken: "token",
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

/**
 * 生成协议测试响应
 * @param body - JSON 响应内容
 * @returns HTTP 成功响应
 */
const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe("流媒体协议契约", () => {
  it.each(["jellyfin", "emby"] as const)(
    "%s 歌单按条目 ID 分页，保留重复歌曲和原顺序",
    async (type) => {
      fetchMock.mockImplementation(async (source: string) => {
        const url = new URL(source);
        const offset = Number(url.searchParams.get("StartIndex"));
        const items = [
          { Id: "song", PlaylistItemId: "first", Name: "同一首歌" },
          { Id: "song", PlaylistItemId: "second", Name: "同一首歌" },
          { Id: "other", PlaylistItemId: "third", Name: "另一首歌" },
        ];
        return response({ Items: items.slice(offset, offset + 1) });
      });
      const tracks = await jellyfinAdapter.getPlaylistSongs({ ...config, type }, "playlist");
      expect(tracks.map((track) => track.originalId)).toEqual(["song", "song", "other"]);
      expect(
        fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("StartIndex")),
      ).toEqual(["0", "1", "2", "3"]);
    },
  );

  it("空媒体库的歌手错误 70 视为空列表，鉴权错误仍然失败", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        "subsonic-response": {
          status: "failed",
          error: { code: 70, message: "Library not found or empty" },
        },
      }),
    );
    expect(await subsonicAdapter.listArtists(config)).toEqual([]);
    fetchMock.mockResolvedValueOnce(
      response({
        "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong password" } },
      }),
    );
    await expect(subsonicAdapter.listArtists(config)).rejects.toMatchObject({ code: 40 });
  });
  it("下载使用原文件端点，不附带转码参数或播放会话", async () => {
    const subsonic = new URL(
      await subsonicAdapter.getDownloadUrl({ ...config, type: "navidrome" }, "song"),
    );
    expect(subsonic.pathname).toBe("/prefix/rest/download");
    expect(subsonic.searchParams.get("v")).toBe("1.13.0");
    expect(subsonic.searchParams.has("format")).toBe(false);
    expect(subsonic.searchParams.has("maxBitRate")).toBe(false);
    const jellyfin = new URL(await jellyfinAdapter.getDownloadUrl(config, "song/id"));
    const emby = new URL(
      await jellyfinAdapter.getDownloadUrl({ ...config, type: "emby" }, "song/id"),
    );
    expect(jellyfin.pathname).toBe("/prefix/Items/song%2Fid/Download");
    expect(jellyfin.searchParams.get("ApiKey")).toBe("token");
    expect(emby.searchParams.get("api_key")).toBe("token");
    expect(jellyfin.searchParams.has("PlaySessionId")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("旧 Subsonic 目录遍历保留无专辑歌曲并去除重复目录", async () => {
    fetchMock.mockImplementation(async (source: string) => {
      const url = new URL(source);
      let body: object = {};
      if (url.pathname.endsWith("getMusicFolders"))
        body = { musicFolders: { musicFolder: [{ id: 1 }] } };
      if (url.pathname.endsWith("getIndexes"))
        body = {
          indexes: {
            index: [{ artist: [{ id: "dir" }] }],
            child: [
              { id: "root-song", title: "散曲" },
              { id: "dir", isDir: true },
            ],
          },
        };
      if (url.pathname.endsWith("getMusicDirectory"))
        body = {
          directory: {
            child: [
              { id: "dir", isDir: true },
              { id: "root-song", title: "散曲" },
              { id: "nested-song", title: "目录歌曲" },
            ],
          },
        };
      return response({ "subsonic-response": { status: "ok", ...body } });
    });
    const songs: Track[] = [];
    for await (const page of subsonicAdapter.scanSongs!({ ...config, type: "subsonic" }))
      songs.push(...page);
    expect(songs.map((song) => song.originalId)).toEqual(["root-song", "nested-song"]);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("getMusicDirectory")),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("search3"))).toBe(false);
  });

  it("Jellyfin 使用现代鉴权，Emby 保留其协议参数", async () => {
    const jelly = new URL(await jellyfinAdapter.getStreamUrl(config, "song", "play"));
    const emby = new URL(
      await jellyfinAdapter.getStreamUrl({ ...config, type: "emby" }, "song", "play"),
    );
    expect(jelly.searchParams.get("ApiKey")).toBe("token");
    expect(jelly.searchParams.has("api_key")).toBe(false);
    expect(emby.searchParams.get("api_key")).toBe("token");
    expect(emby.pathname).toBe("/prefix/Audio/song/stream");
    expect(jelly.searchParams.get("PlaySessionId")).toBe("play");
  });

  it("Jellyfin 映射收藏、专辑封面和空 ArtistItems 的文本歌手", async () => {
    fetchMock.mockResolvedValue(
      response({
        Items: [
          {
            Id: "song",
            Name: "歌曲",
            Artists: ["组合 A / B"],
            ArtistItems: [],
            AlbumId: "album",
            Album: "专辑",
            AlbumPrimaryImageTag: "tag",
            UserData: { IsFavorite: true },
          },
        ],
      }),
    );
    const [track] = await jellyfinAdapter.listSongs(config);
    expect(track.favorite).toBe(true);
    expect(track.artists).toEqual([{ name: "组合 A / B" }]);
    expect(track.cover).toContain("coverId=album");
    expect(track.cover).toContain("tag=tag");
    expect(track.album?.serverId).toBe("server");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/Items?UserId=user-id");
  });

  it("收藏更新使用服务器返回的状态，不乐观假定成功", async () => {
    fetchMock.mockResolvedValue(response({ IsFavorite: false }));
    expect(await jellyfinAdapter.setFavorite(config, "song", true)).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toContain("/UserFavoriteItems/song?");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("Subsonic 保留非同步文本并应用结构化歌词偏移", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        "subsonic-response": {
          status: "ok",
          lyricsList: {
            structuredLyrics: [
              { synced: false, line: [{ value: "文本" }] },
              { synced: true, offset: 500, line: [{ start: 1000, value: "歌词" }] },
            ],
          },
        },
      }),
    );
    expect(await subsonicAdapter.getLyrics({ ...config, type: "navidrome" }, "song")).toBe(
      "[00:00.500]歌词",
    );
    fetchMock.mockResolvedValueOnce(
      response({
        "subsonic-response": {
          status: "ok",
          lyricsList: { structuredLyrics: [{ synced: false, line: [{ value: "纯文本" }] }] },
        },
      }),
    );
    expect(await subsonicAdapter.getLyrics(config, "song")).toBe("纯文本");
  });

  it("歌词鉴权失败不能降级成无歌词", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(jellyfinAdapter.getLyrics(config, "song")).rejects.toBeInstanceOf(
      StreamingRequestError,
    );
    fetchMock.mockResolvedValueOnce(
      response({
        "subsonic-response": { status: "failed", error: { code: 40, message: "wrong password" } },
      }),
    );
    await expect(
      subsonicAdapter.getLyrics(config, "song", { title: "歌曲" }),
    ).rejects.toMatchObject({ code: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Emby 从字幕媒体流读取 LRC，时间单位转换为毫秒", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        Id: "song",
        MediaSources: [{ Id: "source" }],
        MediaStreams: [{ Type: "Subtitle", Codec: "lrc", Index: 2 }],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      response({ TrackEvents: [{ StartPositionTicks: 12340000, Text: "歌词" }] }),
    );
    expect(await jellyfinAdapter.getLyrics({ ...config, type: "emby" }, "song")).toBe(
      "[00:01.234]歌词",
    );
    expect(fetchMock.mock.calls[1][0]).toContain("Items/song/source/Subtitles/2/Stream.js");
  });

  it("服务器播放上报使用对应媒体源和 ticks", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await jellyfinAdapter.reportPlayback(config, {
      event: "progress",
      reason: "Pause",
      trackId: "song",
      sessionId: "play",
      mediaSourceId: "source",
      positionMs: 1234,
      paused: true,
      startedAt: 1,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      PositionTicks: 12340000,
      MediaSourceId: "source",
      PlaySessionId: "play",
      IsPaused: true,
      EventName: "Pause",
    });
  });

  it("Subsonic 正式打卡与正在播放使用不同 submission", async () => {
    fetchMock.mockImplementation(async () => response({ "subsonic-response": { status: "ok" } }));
    const report = {
      trackId: "song",
      sessionId: "play",
      positionMs: 10000,
      paused: false,
      startedAt: 123456,
    };
    await subsonicAdapter.reportPlayback(config, { ...report, event: "start" });
    await subsonicAdapter.reportPlayback(config, { ...report, event: "scrobble" });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("submission")).toBe("false");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("submission")).toBe("true");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("time")).toBe("123456");
  });
});
