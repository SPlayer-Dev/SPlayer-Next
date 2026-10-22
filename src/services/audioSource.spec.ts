import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  netease: vi.fn(),
  qqmusic: vi.fn(),
  kugou: vi.fn(),
  error: vi.fn(),
  lookup: vi.fn(),
  cacheLookup: vi.fn(),
  settings: {
    player: { songLevel: "hq", allowTrialPlay: false },
    system: { cache: { songCache: { enabled: false } } },
  },
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => mocks.settings,
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: [] }) }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({ isLoggedIn: false }) }));
vi.mock("@/apis/song/netease", () => ({ resolveNeteaseUrl: mocks.netease }));
vi.mock("@/apis/song/qqmusic", () => ({ resolveQQMusicUrl: mocks.qqmusic }));
vi.mock("@/apis/song/kugou", () => ({ resolveKugouUrl: mocks.kugou }));
vi.mock("@/utils/errors", () => ({ handleError: mocks.error }));
import { resolveTrackSource } from "./audioSource";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockReset().mockResolvedValue(null);
  mocks.settings.system.cache.songCache.enabled = false;
  Object.assign(window, {
    api: {
      download: { lookup: mocks.lookup },
      cache: { song: { lookup: mocks.cacheLookup } },
    },
  });
});

describe("优先播放下载文件", () => {
  it("远端流媒体只返回身份占位符，凭据和播放会话由主进程解析", async () => {
    const result = await resolveTrackSource({
      id: "server:remote",
      source: "streaming",
      serverId: "server",
      originalId: "remote",
      title: "歌曲",
      artists: [],
      duration: 1000,
    });
    expect(result?.source).toBe("streaming://server/remote");
  });
  it("命中下载后跳过缓存和在线地址解析", async () => {
    mocks.settings.system.cache.songCache.enabled = true;
    mocks.lookup.mockResolvedValueOnce("C:/downloads/song.flac");
    const track: Track = { id: "1", title: "test", source: "netease", artists: [], duration: 1000 };
    expect(await resolveTrackSource(track)).toEqual({
      source: "C:/downloads/song.flac",
      fromCache: false,
      provider: "download",
    });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith({ source: "netease", id: "1" });
    expect(mocks.cacheLookup).not.toHaveBeenCalled();
    expect(mocks.netease).not.toHaveBeenCalled();
  });

  it("流媒体下载按服务器身份查询，并跳过远端地址解析", async () => {
    mocks.lookup.mockResolvedValueOnce("C:/downloads/stream.flac");
    await resolveTrackSource({
      id: "song",
      source: "streaming",
      serverId: "server",
      originalId: "remote",
      title: "stream",
      artists: [],
      duration: 1000,
    });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith({
      source: "streaming",
      id: "song",
      serverId: "server",
      originalId: "remote",
    });
  });

  it("下载查询异常时继续在线解析", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("database error"));
    mocks.netease.mockResolvedValueOnce({
      available: true,
      url: "https://music/song",
      isTrial: false,
    });
    const result = await resolveTrackSource({
      id: "1",
      source: "netease",
      title: "test",
      artists: [],
      duration: 1000,
    });
    expect(result?.source).toBe("https://music/song");
    expect(mocks.netease).toHaveBeenCalledOnce();
  });
});

describe("音源解析失败原因", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it.each(["netease", "qqmusic", "kugou"] as const)(
    "%s API 异常不会被无插件覆盖",
    async (source) => {
      mocks[source].mockRejectedValueOnce(new Error("fetch failed"));
      const onError = vi.fn();
      const track: Track = { id: "1", title: "test", source, artists: [], duration: 1000 };
      expect(await resolveTrackSource(track, { silent: true, onError })).toBeNull();
      expect(onError).toHaveBeenCalledExactlyOnceWith(ErrorCode.NETWORK_ERROR);
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );
  it("歌曲无版权仍保留单曲错误", async () => {
    mocks.netease.mockResolvedValueOnce({
      available: false,
      errorCode: ErrorCode.NETEASE_UNAVAILABLE,
    });
    await resolveTrackSource({
      id: "1",
      title: "test",
      source: "netease",
      artists: [],
      duration: 1000,
    });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(ErrorCode.NETEASE_UNAVAILABLE);
  });
});
