import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: vi.fn() }));
vi.mock("../core/checktoken", () => ({ getAntiCheatTokenV3: vi.fn() }));
vi.mock("../core/device", () => ({ getAnonymousToken: () => "", getDeviceId: () => "device" }));

import { NeteaseRequestError } from "../core/response";
import playlistTracks from "./playlist_tracks";
import playlistSubscribe from "./playlist_subscribe";
import albumSub from "./album_sub";
import artistSub from "./artist_sub";
import songLike from "./song_like";

const response = { status: 200, body: { code: 200 }, cookie: [] };
const request = vi.fn();

describe("收藏模块使用公共网页请求配置", () => {
  beforeEach(() => request.mockReset().mockResolvedValue(response));
  it.each([301, 302, 401, 502, 512])(
    "歌单添加业务 %s 原样返回，不通过重复 ID 强制重试",
    async (code) => {
      const error = new NeteaseRequestError({ status: code, body: { code }, cookie: [] });
      request.mockRejectedValueOnce(error);
      await expect(playlistTracks({ op: "add", pid: 1, tracks: "2,3" }, request)).rejects.toBe(
        error,
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][1].trackIds).toBe('["2","3"]');
    },
  );
  it("歌单增删共用网页请求层", async () => {
    await playlistTracks({ op: "del", pid: 1, tracks: "2,3" }, request);
    expect(request.mock.calls[0]).toEqual([
      "/api/playlist/manipulate/tracks",
      { op: "del", pid: 1, trackIds: '["2","3"]', imme: "true" },
      expect.objectContaining({ client: "web", crypto: "weapi" }),
    ]);
  });
  it.each([1, "1", 2, "2"])("歌单订阅参数 %s 选择正确路径，SDK 是否启用交给公共层", async (t) => {
    await playlistSubscribe({ id: 1, t }, request);
    expect(request.mock.calls[0][0]).toBe(
      Number(t) === 2 ? "/api/playlist/unsubscribe" : "/api/playlist/subscribe",
    );
    expect(request.mock.calls[0][1]).toEqual({ id: 1 });
    expect(request.mock.calls[0][2]).toMatchObject({ client: "web", crypto: "weapi" });
  });
  it.each([1, "1", 2, "2"])("歌手和专辑参数 %s 都通过公共路径匹配", async (t) => {
    await artistSub({ id: 1, t }, request);
    await albumSub({ id: 2, t }, request);
    const action = Number(t) === 2 ? "unsub" : "sub";
    expect(request.mock.calls[0][0]).toBe("/api/artist/" + action);
    expect(request.mock.calls[1][0]).toBe("/api/album/" + action);
    expect(
      request.mock.calls.every(
        ([, , options]) => options.client === "web" && options.crypto === "weapi",
      ),
    ).toBe(true);
  });
  it.each([true, false, "false"])(
    "歌曲红心 %s 只提交业务字段，不判断额外确认字段",
    async (like) => {
      expect(await songLike({ id: 1, uid: 2, like }, request)).toBe(response);
      expect(request.mock.calls[0]).toEqual([
        "/api/song/like",
        { trackId: "1", userid: "2", like: String(like !== false && like !== "false") },
        expect.objectContaining({ client: "web", crypto: "weapi" }),
      ]);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
