import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { neteaseCall } from "@/apis/netease";

const cache = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<unknown>>(async () => null),
  setItem: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => undefined),
}));

vi.mock("localforage", () => ({
  default: { createInstance: () => cache },
}));

import { useUserStore } from "./user";

const profile = { userId: 1, nickname: "测试用户" };
const song = (id: number) => ({ id, name: String(id), ar: [], al: { id: 0 }, dt: 1000 });
const playlist = { id: 10, name: "我喜欢的音乐", creator: profile };

describe("平台用户会话与喜欢列表", () => {
  const call = vi.fn();
  const clearSession = vi.fn(async () => undefined);
  let bodies: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    setActivePinia(createPinia());
    cache.getItem.mockReset().mockResolvedValue(null);
    cache.setItem.mockClear();
    clearSession.mockClear();
    bodies = {
      login_status: { data: { code: 200, account: { id: 1 }, profile } },
      login_refresh: { code: 200 },
      user_subcount: { code: 200, createdPlaylistCount: 1 },
      user_playlist: { code: 200, playlist: [playlist] },
      likelist: { code: 200, ids: [1, 2] },
      album_sublist: { code: 200, data: [] },
      artist_sublist: { code: 200, data: [] },
      user_level: { code: 200, data: { level: 1 } },
      playlist_detail: {
        code: 200,
        playlist: { ...playlist, trackIds: [{ id: 1 }, { id: 2 }], tracks: [song(1)] },
      },
      song_detail: { code: 200, songs: [] },
      like_v1: { code: 200 },
      song_like: { code: 200 },
    };
    call.mockReset().mockImplementation(async (_platform, name) => ({
      ok: true,
      status: 200,
      body: bodies[name],
    }));
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { apis: { call, clearSession } },
    });
  });

  const loggedInStore = () => {
    const store = useUserStore();
    store.profile = { ...profile };
    store.lastRefreshAt = Date.now();
    return store;
  };

  it("传输层成功包装的登录失效仍然立即清除账号", async () => {
    const store = loggedInStore();
    bodies.user_subcount = { code: 302, msg: "需要登录" };

    await expect(neteaseCall("user_subcount")).rejects.toThrow();

    expect(store.isLoggedIn).toBe(false);
    expect(clearSession).toHaveBeenCalledWith("netease");
    expect(call.mock.calls.some(([, name]) => name === "login_status")).toBe(false);
  });

  it("登录状态查询业务 502 保留离线资料", async () => {
    const store = loggedInStore();
    bodies.login_status = { code: 502, msg: "服务暂时不可用" };

    expect(await store.fetchStatus()).toBe(true);
    expect(store.profile?.userId).toBe(1);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("游客账号会清掉持久化的旧登录标记", async () => {
    const store = loggedInStore();
    bodies.login_status = { data: { code: 200, account: { anonimous: true }, profile: null } };

    expect(await store.fetchStatus()).toBe(false);
    expect(store.isLoggedIn).toBe(false);
  });

  it("退出后返回的旧内容请求不会恢复收藏", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const implementation = call.getMockImplementation()!;
    call.mockImplementation((platform, name, params) =>
      name === "album_sublist" ? pending : implementation(platform, name, params),
    );
    const loading = store.loadContent(1);
    await vi.waitFor(() =>
      expect(call.mock.calls.some(([, name]) => name === "album_sublist")).toBe(true),
    );

    await store.invalidateSession();
    finish({ ok: true, status: 200, body: { code: 200, data: [{ id: 99, name: "旧专辑" }] } });
    await loading;

    expect(store.profile).toBeNull();
    expect(store.albums).toEqual([]);
    expect(store.playlists).toEqual([]);
    expect(store.likedSongIds.size).toBe(0);
  });

  it("歌曲详情缺失不会被当成取消红心", async () => {
    const store = loggedInStore();
    await store.loadContent(1);
    await store.ensureLikedPlaylist();

    expect([...store.likedSongIds]).toEqual(["1", "2"]);
    expect(store.likedPlaylistTracks.map(({ id }) => id)).toEqual(["1"]);
    call.mockClear();
    await store.ensureLikedPlaylist();
    expect(call.mock.calls.filter(([, name]) => name === "playlist_detail")).toHaveLength(0);
  });

  it("再次进入喜欢页会发现外部新增的红心", async () => {
    const store = loggedInStore();
    await store.loadContent(1);
    await store.ensureLikedPlaylist();
    bodies.likelist = { code: 200, ids: [1, 2, 3] };
    bodies.playlist_detail = {
      code: 200,
      playlist: {
        ...playlist,
        trackIds: [{ id: 3 }, { id: 1 }, { id: 2 }],
        tracks: [song(3), song(1)],
      },
    };

    await store.ensureLikedPlaylist();

    expect(store.isLiked("3")).toBe(true);
    expect(store.likedPlaylistTracks.map(({ id }) => id)).toEqual(["3", "1"]);
  });

  it("强制刷新失败时保留原有喜欢曲目", async () => {
    const store = loggedInStore();
    await store.loadContent(1);
    await store.ensureLikedPlaylist();
    bodies.playlist_detail = { code: 502, msg: "网关错误" };

    await store.ensureLikedPlaylist(true);

    expect(store.likedPlaylistTracks.map(({ id }) => id)).toEqual(["1"]);
    expect([...store.likedSongIds]).toEqual(["1", "2"]);
    expect(store.likedPlaylistLoading).toBe(false);
  });

  it("后台旧红心响应不会覆盖刚完成的操作", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const implementation = call.getMockImplementation()!;
    call.mockImplementation((platform, name, params) =>
      name === "likelist" ? pending : implementation(platform, name, params),
    );
    const loading = store.loadContent(1);
    await vi.waitFor(() =>
      expect(call.mock.calls.some(([, name]) => name === "likelist")).toBe(true),
    );

    expect(await store.toggleLike("3")).toBe(true);
    finish({ ok: true, status: 200, body: { code: 200, ids: [1, 2] } });
    await loading;

    expect(store.isLiked("3")).toBe(true);
  });

  it("连续触发喜欢同步只发送一组请求", async () => {
    const store = loggedInStore();
    await store.loadContent(1);
    call.mockClear();

    await Promise.all([store.ensureLikedPlaylist(), store.ensureLikedPlaylist()]);

    expect(call.mock.calls.filter(([, name]) => name === "likelist")).toHaveLength(1);
    expect(call.mock.calls.filter(([, name]) => name === "playlist_detail")).toHaveLength(1);
  });

  it("业务 200 直接更新红心和缓存，不要求合成确认字段", async () => {
    const store = loggedInStore();
    bodies.song_like = { code: 200 };
    expect(await store.toggleLike("3")).toBe(true);
    expect(store.isLiked("3")).toBe(true);
    expect(cache.setItem).toHaveBeenCalled();
    expect(call.mock.calls.some(([, name]) => name === "like_v1" || name === "like")).toBe(false);
  });

  it("取消红心依据业务 200 更新状态", async () => {
    const store = loggedInStore();
    store.likedSongIds = new Set(["3"]);
    bodies.song_like = { code: 200 };
    expect(await store.toggleLike("3")).toBe(true);
    expect(store.isLiked("3")).toBe(false);
    expect(call).toHaveBeenCalledWith("netease", "song_like", { id: "3", like: false, uid: 1 });
  });

  it("重复点击同一曲目只发一次收藏写入", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = store.toggleLike("3");
    expect(store.isLiked("3")).toBe(true);
    expect(store.isLikePending("3")).toBe(true);
    expect(await store.toggleLike("3")).toBe(false);
    finish({ ok: true, status: 200, body: { code: 200 } });
    expect(await first).toBe(true);
    expect(call.mock.calls.filter(([, name]) => name === "song_like")).toHaveLength(1);
    expect(store.isLikePending("3")).toBe(false);
  });

  it("旧账号写入完成后不能恢复新账号红心", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = store.toggleLike("3");
    await store.invalidateSession();
    store.profile = { ...profile, userId: 2 };
    finish({ ok: true, status: 200, body: { code: 200 } });
    expect(await pending).toBe(false);
    expect(store.isLiked("3")).toBe(false);
    expect(cache.setItem.mock.calls.some(([key]) => key === "liked-song-ids")).toBe(false);
  });

  it("401 不会自动改写喜欢歌单", async () => {
    const store = loggedInStore();
    store.playlists = [{ id: "10", name: "我喜欢的音乐" }];
    call.mockResolvedValueOnce({ ok: false, status: 401, body: { code: 401 }, error: "受限" });
    expect(await store.toggleLike("3")).toBe(false);
    expect(call.mock.calls.some(([, name]) => name === "playlist_tracks")).toBe(false);
    expect(store.isLiked("3")).toBe(false);
  });

  it("并行操作不会把另一首在途歌曲写进红心缓存", async () => {
    const store = loggedInStore();
    const finish: Array<(value: unknown) => void> = [];
    call.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const first = store.toggleLike("3");
    const second = store.toggleLike("4");
    expect([...store.likedSongIds]).toEqual(["3", "4"]);
    expect(cache.setItem).not.toHaveBeenCalled();
    finish[0]({ ok: true, status: 200, body: { code: 200 } });
    expect(await first).toBe(true);
    const saved = cache.setItem.mock.calls.find(([key]) => key === "liked-song-ids")![1] as {
      ids: string[];
    };
    expect(saved.ids).toEqual(["3"]);
    finish[1]({
      ok: false,
      error: "请求失败",
      status: 502,
      body: { code: 502 },
    });
    expect(await second).toBe(false);
    expect([...store.likedSongIds]).toEqual(["3"]);
  });

  it("添加红心立即生效，失败恢复原状态且不落缓存", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const pending = store.toggleLike("3");
    expect(store.isLiked("3")).toBe(true);
    expect(cache.setItem).not.toHaveBeenCalled();

    finish({ ok: false, status: 502, body: { code: 502 }, error: "请求失败" });
    expect(await pending).toBe(false);
    expect(store.isLiked("3")).toBe(false);
    expect(store.isLikePending("3")).toBe(false);
    expect(cache.setItem).not.toHaveBeenCalled();
  });

  it("取消红心立即生效，失败恢复红心和喜欢列表", async () => {
    const store = loggedInStore();
    store.likedSongIds = new Set(["3"]);
    store.likedPlaylistTracks = [
      { id: "3", title: "3", source: "netease", artists: [], duration: 1000 },
    ];
    let finish!: (value: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const pending = store.toggleLike("3");
    expect(store.isLiked("3")).toBe(false);

    finish({ ok: false, status: 502, body: { code: 502 }, error: "请求失败" });
    expect(await pending).toBe(false);
    expect(store.isLiked("3")).toBe(true);
    expect(store.likedPlaylistTracks.map(({ id }) => id)).toEqual(["3"]);
    expect(cache.setItem).not.toHaveBeenCalled();
  });

  it("并行取消未完成时，其他歌曲成功的缓存仍保留原红心", async () => {
    const store = loggedInStore();
    store.likedSongIds = new Set(["1"]);
    const finish: Array<(value: unknown) => void> = [];
    call.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const removing = store.toggleLike("1");
    const adding = store.toggleLike("3");
    expect([...store.likedSongIds]).toEqual(["3"]);

    finish[1]({ ok: true, status: 200, body: { code: 200 } });
    expect(await adding).toBe(true);
    const saved = cache.setItem.mock.calls.find(([key]) => key === "liked-song-ids")![1] as {
      ids: string[];
    };
    expect(new Set(saved.ids)).toEqual(new Set(["1", "3"]));

    finish[0]({ ok: false, status: 502, body: { code: 502 }, error: "请求失败" });
    expect(await removing).toBe(false);
    expect(new Set(store.likedSongIds)).toEqual(new Set(["1", "3"]));
  });

  it("收藏期间新发起的内容同步不会覆盖红心或保存临时状态", async () => {
    const store = loggedInStore();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => (finish = resolve));
    const implementation = call.getMockImplementation()!;
    call.mockImplementation((platform, name, params) =>
      name === "song_like" ? pending : implementation(platform, name, params),
    );
    cache.getItem.mockImplementation(async (key) =>
      key === "liked-song-ids" ? { userId: 1, ids: ["1", "2"], cachedAt: 0 } : null,
    );
    const liking = store.toggleLike("3");

    await store.loadContent(1);
    expect(store.isLiked("3")).toBe(true);
    expect(cache.setItem.mock.calls.some(([key]) => key === "liked-song-ids")).toBe(false);

    finish({ ok: true, status: 200, body: { code: 200 } });
    expect(await liking).toBe(true);
    expect(store.isLiked("3")).toBe(true);
  });

  it("旧账号的失败不能回滚新账号红心或释放新账号的在途保护", async () => {
    const store = loggedInStore();
    const finish: Array<(value: unknown) => void> = [];
    call.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const oldRequest = store.toggleLike("3");
    store.clearContent();
    store.profile = { ...profile, userId: 2 };
    const newRequest = store.toggleLike("3");
    expect(store.isLiked("3")).toBe(true);

    finish[0]({ ok: false, status: 502, body: { code: 502 }, error: "请求失败" });
    expect(await oldRequest).toBe(false);
    expect(store.isLiked("3")).toBe(true);
    expect(store.isLikePending("3")).toBe(true);
    expect(await store.toggleLike("3")).toBe(false);

    finish[1]({ ok: true, status: 200, body: { code: 200 } });
    expect(await newRequest).toBe(true);
    expect(store.isLikePending("3")).toBe(false);
    expect(call.mock.calls.filter(([, name]) => name === "song_like")).toHaveLength(2);
  });

  it("加入喜欢歌单逐曲提交，部分失败只保存已成功的歌曲", async () => {
    const store = loggedInStore();
    store.playlists = [{ id: "10", name: "我喜欢的音乐" }];
    const implementation = call.getMockImplementation()!;
    call.mockImplementation((platform, name, params) => {
      if (name === "song_like" && params.id === "4") {
        return Promise.resolve({ ok: false, status: 502, body: { code: 502 }, error: "请求失败" });
      }
      return implementation(platform, name, params);
    });
    await expect(store.addTracksToPlaylist("10", ["3", "4"])).rejects.toThrow("请求失败");
    expect([...store.likedSongIds]).toEqual(["3"]);
    expect(call.mock.calls.some(([, name]) => name === "playlist_tracks")).toBe(false);
  });

  it("从喜欢歌单移除歌曲复用成功的取消红心流程", async () => {
    const store = loggedInStore();
    store.playlists = [{ id: "10", name: "我喜欢的音乐" }];
    store.likedSongIds = new Set(["3"]);
    bodies.song_like = { code: 200 };
    await store.removeTracksFromPlaylist("10", ["3", "3"]);
    expect(store.isLiked("3")).toBe(false);
    expect(call.mock.calls.filter(([, name]) => name === "song_like")).toHaveLength(1);
    expect(call.mock.calls.some(([, name]) => name === "playlist_tracks")).toBe(false);
  });
});
