/**
 * KG 分页拉取辅助
 *
 * 酷狗歌单/专辑接口按 page 分页返回，此模块封装「先取第一页拿 total，
 * 再并发补拉剩余页」的全量拉取逻辑，供 playlist / album 模块复用。
 */

/** special/song 单页条数（保持接口示例值，翻页逻辑负责取全量） */
export const SONG_PAGESIZE = 300;

/** 单个歌单/专辑最多拉取的歌曲数，防止异常 total 无限翻页 */
export const MAX_SONGS = 5000;

/** 分页响应的 data 结构 */
export interface PagedResponse<T> {
  data?: { info?: T[]; total?: number };
}

/**
 * 拉取全量分页数据：先取第一页拿 total，再并发补拉剩余页
 * @param requestPage - 页码 → 该页响应的请求函数
 * @returns 全量条目；个别补拉页失败时返回已拿到的部分
 */
export const fetchAllPages = async <T>(
  requestPage: (page: number) => Promise<PagedResponse<T>>,
): Promise<T[]> => {
  const first = await requestPage(1);
  const firstItems = first.data?.info ?? [];
  const total = Math.min(first.data?.total ?? firstItems.length, MAX_SONGS);
  const restCount = total - firstItems.length;
  if (restCount <= 0) return firstItems;

  const pages = Math.ceil(restCount / SONG_PAGESIZE);
  const rest = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      requestPage(i + 2).catch(() => ({ data: {} as never })),
    ),
  );
  const merged = [...firstItems, ...rest.flatMap((r) => r.data?.info ?? [])];
  return merged.slice(0, total);
};
