import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  likelist: vi.fn(),
  scrobble_v1: vi.fn(),
  record_recent_song: vi.fn(),
  user_record: vi.fn(),
  search: vi.fn(),
  login_refresh: vi.fn(),
  song_like: vi.fn(),
  artist_sub: vi.fn(),
  album_sub: vi.fn(),
  playlist_subscribe: vi.fn(),
  playlist_tracks: vi.fn(),
  getSessionCookies: vi.fn(() => ({ MUSIC_U: "test-session" })),
  saveSessionCookies: vi.fn(),
  clearSessionCookies: vi.fn(),
}));

vi.mock("@main/database/sessions", () => api);
vi.mock("@main/store", () => ({ store: { get: () => false } }));
vi.mock("@main/utils/logger", () => ({ neteaseLog: { info: vi.fn() } }));
vi.mock("./core/request", () => ({ createRequest: vi.fn() }));
vi.mock("./core/xeapi", () => ({ resetXeapiKey: vi.fn() }));
vi.mock("./core/webClient", () => ({ resetWebClientSession: vi.fn() }));
vi.mock("./core/device", () => ({
  getAnonymousToken: () => "",
  getDeviceId: () => "test-device",
  setAnonymousToken: vi.fn(),
  setDeviceId: vi.fn(),
}));
vi.mock("./modules", () => ({
  modules: {
    likelist: api.likelist,
    scrobble_v1: api.scrobble_v1,
    record_recent_song: api.record_recent_song,
    user_record: api.user_record,
    search: api.search,
    login_refresh: api.login_refresh,
    song_like: api.song_like,
    artist_sub: api.artist_sub,
    album_sub: api.album_sub,
    playlist_subscribe: api.playlist_subscribe,
    playlist_tracks: api.playlist_tracks,
  },
}));

import { callNetease, clearNeteaseCookies, setNeteaseCookies } from "./index";

const response = (code: number, cookie: string[] = []) => ({
  status: 200,
  body: { code, ids: [1] },
  cookie,
});

describe("平台主进程缓存与会话", () => {
  beforeEach(() => {
    setNeteaseCookies({ MUSIC_U: "test-session" });
    api.saveSessionCookies.mockClear();
    api.clearSessionCookies.mockClear();
    api.likelist.mockReset().mockResolvedValue(response(200));
    api.scrobble_v1.mockReset().mockResolvedValue(response(200));
    api.record_recent_song.mockReset();
    api.user_record.mockReset();
    api.search.mockReset().mockResolvedValue(response(200));
    api.login_refresh.mockReset().mockResolvedValue(response(200));
    for (const name of [
      "song_like",
      "artist_sub",
      "album_sub",
      "playlist_subscribe",
      "playlist_tracks",
    ] as const) {
      api[name].mockReset().mockResolvedValue(response(200, ["sdkState=current; Path=/"]));
    }
  });

  it.each([
    "song_like",
    "artist_sub",
    "album_sub",
    "playlist_subscribe",
    "playlist_tracks",
  ] as const)("%s 不缓存业务写入并保留网页会话 Cookie", async (name) => {
    await callNetease(name, { id: 1 });
    await callNetease(name, { id: 1 });
    expect(api[name]).toHaveBeenCalledTimes(2);
    expect(api.saveSessionCookies).toHaveBeenCalledWith(
      "netease",
      expect.objectContaining({ sdkState: "current" }),
    );
  });

  it("NCBL 上报每次都发送，不能缓存重复播放的相同参数", async () => {
    await callNetease("scrobble_v1", { id: 1, time: 180 });
    await callNetease("scrobble_v1", { id: 1, time: 180 });
    expect(api.scrobble_v1).toHaveBeenCalledTimes(2);
  });

  it("红心列表每次从服务端读取", async () => {
    await callNetease("likelist", { uid: 1 });
    await callNetease("likelist", { uid: 1 });

    expect(api.likelist).toHaveBeenCalledTimes(2);
  });

  it.each(["record_recent_song", "user_record"] as const)(
    "%s 的前后查询直接读取服务端变化",
    async (name) => {
      const before = { status: 200, body: { code: 200, data: { list: [] } }, cookie: [] };
      const after = {
        status: 200,
        body: { code: 200, data: { list: [{ resourceId: 123, playTime: 1700000000000 }] } },
        cookie: [],
      };
      api[name].mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      const params = { limit: 1, uid: 1, type: 1 };
      expect((await callNetease(name, params)).body).toEqual(before.body);
      expect((await callNetease(name, params)).body).toEqual(after.body);
      expect(api[name]).toHaveBeenCalledTimes(2);
      expect(api[name]).toHaveBeenCalledWith(
        expect.objectContaining({ cookie: { MUSIC_U: "test-session" } }),
        expect.any(Function),
      );
    },
  );

  it("业务 502 不会因为包装状态为 200 而被缓存", async () => {
    api.search.mockResolvedValue(response(502));

    await callNetease("search", { keywords: "test" });
    await callNetease("search", { keywords: "test" });

    expect(api.search).toHaveBeenCalledTimes(2);
  });

  it("正常公开响应仍然采用有界缓存", async () => {
    await callNetease("search", { keywords: "test" });
    await callNetease("search", { keywords: "test" });

    expect(api.search).toHaveBeenCalledTimes(1);
  });

  it("登出后的旧续期响应不能恢复 MUSIC_U", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    api.login_refresh.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = callNetease("login_refresh");

    clearNeteaseCookies();
    finish(response(200, ["MUSIC_U=old-session; Path=/"]));
    await pending;

    expect(api.saveSessionCookies).not.toHaveBeenCalled();
    expect(api.clearSessionCookies).toHaveBeenCalledWith("netease");
  });

  it("切换账号后的旧公开响应不会进入新账号缓存", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    api.search.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = callNetease("search", { keywords: "test" });
    await vi.waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));

    setNeteaseCookies({ MUSIC_U: "new-session" });
    finish(response(200));
    await pending;
    await callNetease("search", { keywords: "test" });

    expect(api.search).toHaveBeenCalledTimes(2);
  });
});
