/** 分页响应经过接口适配后的数据 */
export interface KGPage<T> {
  items: T[];
  total?: number;
}

/**
 * 按顺序拉取完整列表，限制并发并向调用方传播失败
 * @param requestPage - 按页码请求并适配接口数据
 * @param pageSize - 当前接口使用的单页条数
 * @returns 全量条目和服务端总数
 */
export const fetchAllPages = async <T>(
  requestPage: (page: number) => Promise<KGPage<T>>,
  pageSize: number,
): Promise<{ items: T[]; total: number }> => {
  const first = await requestPage(1);
  const items = first.items;

  if (first.total === undefined) {
    let page = 1;
    let pageLength = items.length;
    while (pageLength === pageSize) {
      const next = await requestPage(++page);
      items.push(...next.items);
      pageLength = next.items.length;
    }
    return { items, total: items.length };
  }

  const pageCount = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= pageCount; page += 3) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(3, pageCount - page + 1) }, (_, index) =>
        requestPage(page + index),
      ),
    );
    for (const result of pages) items.push(...result.items);
  }

  if (items.length < first.total) throw new Error("KG 列表数据不完整，请重试");
  return { items: items.slice(0, first.total), total: first.total };
};
