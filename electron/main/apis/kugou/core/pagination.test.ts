import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAllPages, type PagedResponse } from "./pagination";

interface Song {
  hash: string;
}

/** 生成 n 首伪歌曲数据 */
const makeSongs = (n: number, offset = 0): Song[] =>
  Array.from({ length: n }, (_, i) => ({ hash: `hash${offset + i}` }));

/**
 * 构造按页返回的 requestPage 替身
 * @param pages - 每页的 { total, count, offset } 描述（下标 0 = 第 1 页）
 * @param failPages - 需要抛错的页码集合
 */
const createPagedRequest = (
  pages: Array<{ total?: number; count: number; offset: number }>,
  failPages: number[] = [],
) => {
  const calls: number[] = [];
  const requestPage = async (page: number): Promise<PagedResponse<Song>> => {
    calls.push(page);
    if (failPages.includes(page)) throw new Error("timeout");
    const entry = pages[page - 1];
    if (!entry) return { data: { info: [], total: pages[0]?.total ?? 0 } };
    return { data: { info: makeSongs(entry.count, entry.offset), total: entry.total } };
  };
  return { calls, requestPage };
};

describe("酷狗分页全量拉取", () => {
  it("不足一页时不翻页，直接返回", async () => {
    const { calls, requestPage } = createPagedRequest([{ total: 120, count: 120, offset: 0 }]);
    const songs = await fetchAllPages<Song>(requestPage);

    assert.equal(songs.length, 120);
    assert.deepEqual(calls, [1], "只应请求第一页");
  });

  it("超过一页时并发补拉剩余页并按顺序拼接", async () => {
    // 833 首：第 1 页 300 + 第 2 页 300 + 第 3 页 233
    const { calls, requestPage } = createPagedRequest([
      { total: 833, count: 300, offset: 0 },
      { total: 833, count: 300, offset: 300 },
      { total: 833, count: 233, offset: 600 },
    ]);
    const songs = await fetchAllPages<Song>(requestPage);

    assert.equal(songs.length, 833);
    assert.deepEqual(calls.sort(), [1, 2, 3], "应请求全部 3 页");
    // 拼接顺序：第 301 首应来自第 2 页的 offset
    assert.equal(songs[300]?.hash, "hash300");
    assert.equal(songs[832]?.hash, "hash832");
  });

  it("整页数歌单（无零头页）也正确翻页", async () => {
    // 600 首 = 2 页整
    const { calls, requestPage } = createPagedRequest([
      { total: 600, count: 300, offset: 0 },
      { total: 600, count: 300, offset: 300 },
    ]);
    const songs = await fetchAllPages<Song>(requestPage);

    assert.equal(songs.length, 600);
    assert.equal(calls.length, 2);
  });

  it("个别补拉页失败时容错返回已拿到的部分", async () => {
    // 833 首但第 2 页超时：返回 300 + 233 = 533 首，不整体失败
    const { requestPage } = createPagedRequest(
      [
        { total: 833, count: 300, offset: 0 },
        { total: 833, count: 300, offset: 300 },
        { total: 833, count: 233, offset: 600 },
      ],
      [2],
    );
    const songs = await fetchAllPages<Song>(requestPage);

    assert.equal(songs.length, 533);
    assert.equal(songs[300]?.hash, "hash600", "缺口后应接第 3 页数据");
  });

  it("第一页失败时抛错（由上层决定降级）", async () => {
    const { requestPage } = createPagedRequest([{ total: 300, count: 300, offset: 0 }], [1]);
    await assert.rejects(() => fetchAllPages<Song>(requestPage), /timeout/);
  });

  it("接口 total 异常巨大时按 MAX_SONGS 上限封顶", async () => {
    let maxPage = 0;
    const requestPage = async (page: number): Promise<PagedResponse<Song>> => {
      maxPage = Math.max(maxPage, page);
      return { data: { info: makeSongs(300, (page - 1) * 300), total: 100000 } };
    };
    const songs = await fetchAllPages<Song>(requestPage);

    // 5000 上限：第 1 页 300 + 补拉 4700 = 5000，共 17 页后停止
    assert.equal(songs.length, 5000);
    assert.equal(maxPage, 17);
  });

  it("第一页未返回 total 时按本页数量收工（不盲翻）", async () => {
    const { calls, requestPage } = createPagedRequest([
      { total: undefined, count: 300, offset: 0 },
    ]);
    const songs = await fetchAllPages<Song>(requestPage);

    assert.equal(songs.length, 300);
    assert.deepEqual(calls, [1], "无 total 时不应继续翻页");
  });
});
