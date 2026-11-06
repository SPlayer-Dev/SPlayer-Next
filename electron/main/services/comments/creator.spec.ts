// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicCommentItem } from "@shared/types/comment";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({
  hot: new Map<number, unknown>(),
  fresh: new Map<number, unknown>(),
  artists: new Map<string, unknown>(),
  calls: [] as string[],
  meta: { songId: "100", artistIds: ["500"] } as { songId: string; artistIds: string[] } | null,
  metaCalls: 0,
  creator: null as unknown as (args: {
    sourceId: string;
    track: Track;
  }) => Promise<MusicCommentItem[]>,
}));

vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("./index", () => ({
  findNeteaseSongMeta: async () => {
    state.metaCalls += 1;
    return state.meta;
  },
}));
vi.mock("@main/apis/netease", () => ({
  callNetease: async (name: string, params: { id?: string; offset?: number; limit?: number }) => {
    const id = String(params.id ?? "");
    state.calls.push(`${name}:${id}`);
    if (name === "artists") return state.artists.get(id) ?? { status: 500, body: {} };
    const page = Math.floor((params.offset ?? 0) / (params.limit ?? 20)) + 1;
    const table = name === "comment_hot" ? state.hot : state.fresh;
    const registered = table.get(page);
    if (registered) return registered;
    // 未注册的页视为最后一页
    return {
      status: 200,
      body:
        name === "comment_hot" ? { hotComments: [], more: false } : { comments: [], more: false },
    };
  },
}));

const track: Track = {
  id: "100",
  source: "netease",
  title: "歌名",
  artists: [{ id: "500", name: "歌手" }],
  duration: 180000,
};

const creatorComment = (id: string, likedCount: number) => ({
  commentId: id,
  content: `内容${id}`,
  likedCount,
  user: { userId: 200, nickname: "主创" },
});

const listenerComment = (id: string) => ({
  commentId: id,
  content: `内容${id}`,
  user: { userId: 300, nickname: "听众" },
});

/**
 * 注册一页评论响应
 * @param type - hot 热评 / new 普通评论
 * @param page - 页码
 * @param comments - 该页原始评论
 * @param more - 该页是否还有下一页
 */
const setPage = (type: "hot" | "new", page: number, comments: unknown[], more: boolean): void => {
  const body = type === "hot" ? { hotComments: comments, more } : { comments, more };
  (type === "hot" ? state.hot : state.fresh).set(page, { status: 200, body });
};

/**
 * 注册歌手账号解析响应
 * @param accountId - 网易云账号 id，0 表示未绑定
 */
const setArtist = (accountId: number): void => {
  state.artists.set(
    "500",
    accountId > 0
      ? { status: 200, body: { artist: { accountId, name: "歌手" } } }
      : { status: 200, body: { artist: { accountId } } },
  );
};

const loadCreator = async (): Promise<void> => {
  // 每次重新加载模块，避免进程级缓存跨用例串味
  vi.resetModules();
  state.creator = (await import("./creator")).getCreatorComments;
};

describe("主创说抓取", () => {
  beforeEach(() => {
    state.hot.clear();
    state.fresh.clear();
    state.artists.clear();
    state.calls.length = 0;
    state.metaCalls = 0;
    state.meta = { songId: "100", artistIds: ["500"] };
    setArtist(200);
  });

  it("热评首页命中时只发一次热评请求", async () => {
    setPage("hot", 1, [creatorComment("1", 5), listenerComment("2")], true);
    await loadCreator();
    const result = await state.creator({ sourceId: "builtin:netease", track });
    expect(result).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("comment_hot"))).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("comment_music"))).toHaveLength(0);
  });

  it("热评翻页后无命中转普通评论，首个命中页即停", async () => {
    setPage("hot", 1, [listenerComment("1")], true);
    setPage("hot", 2, [listenerComment("2")], true);
    setPage("hot", 3, [listenerComment("3")], false);
    setPage("new", 1, [creatorComment("9", 3)], true);
    await loadCreator();
    const result = await state.creator({ sourceId: "builtin:netease", track });
    expect(result).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("comment_hot"))).toHaveLength(3);
    expect(state.calls.filter((call) => call.startsWith("comment_music"))).toHaveLength(1);
  });

  it("more 为假时两个阶段都立即截断", async () => {
    setPage("hot", 1, [listenerComment("1")], false);
    setPage("new", 1, [listenerComment("2")], false);
    await loadCreator();
    const result = await state.creator({ sourceId: "builtin:netease", track });
    expect(result).toEqual([]);
    expect(state.calls.filter((call) => call.startsWith("comment_hot"))).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("comment_music"))).toHaveLength(1);
  });

  it("非 200 状态直接失败", async () => {
    state.hot.set(1, { status: 500, body: {} });
    await loadCreator();
    await expect(state.creator({ sourceId: "builtin:netease", track })).rejects.toThrow(
      "netease comment request failed: 500",
    );
  });

  it("歌手解析失败不写负缓存，后续请求仍会重试", async () => {
    state.artists.set("500", { status: 500, body: {} });
    await loadCreator();
    expect(await state.creator({ sourceId: "builtin:netease", track })).toEqual([]);
    expect(state.calls.filter((call) => call.startsWith("artists"))).toHaveLength(1);
    setArtist(200);
    setPage("hot", 1, [creatorComment("1", 5)], false);
    expect(await state.creator({ sourceId: "builtin:netease", track })).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("artists"))).toHaveLength(2);
  });

  it("歌手未绑定账号时直接返回空，不请求评论", async () => {
    setArtist(0);
    await loadCreator();
    expect(await state.creator({ sourceId: "builtin:netease", track })).toEqual([]);
    expect(state.calls.filter((call) => call.startsWith("comment_hot"))).toHaveLength(0);
  });

  it("同曲第二次调用命中缓存，不再请求元信息与评论", async () => {
    setPage("hot", 1, [creatorComment("1", 5)], true);
    await loadCreator();
    await state.creator({ sourceId: "builtin:netease", track });
    const calls = state.calls.length;
    await state.creator({ sourceId: "builtin:netease", track });
    expect(state.calls.length).toBe(calls);
  });

  it("结果按点赞数降序", async () => {
    setPage(
      "hot",
      1,
      [creatorComment("1", 1), creatorComment("2", 30), creatorComment("3", 10)],
      false,
    );
    await loadCreator();
    const result = await state.creator({ sourceId: "builtin:netease", track });
    expect(result.map((item) => item.id)).toEqual(["2", "3", "1"]);
  });

  it("非网易云源直接返回空且不发请求", async () => {
    await loadCreator();
    expect(await state.creator({ sourceId: "builtin:qqmusic", track })).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });
});
