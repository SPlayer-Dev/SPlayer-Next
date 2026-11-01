import type { StreamingListParams } from "@shared/types/streaming";

/**
 * 持续读取到空页，兼容服务端比请求值更小的分页上限
 * @param fetchPage - 分页请求
 * @param identify - 条目唯一标识
 * @param signal - 任务取消信号
 * @returns 不重复且已确认结束的分页数据
 */
export async function* streamPages<T>(
  fetchPage: (params: StreamingListParams) => Promise<T[]>,
  identify: (item: T) => string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<T[]> {
  let offset = 0;
  const seen = new Set<string>();
  while (true) {
    signal?.throwIfAborted();
    const page = await fetchPage({ offset, limit: offset === 0 ? 100 : 500 });
    signal?.throwIfAborted();
    if (page.length === 0) return;
    for (const item of page) {
      const id = identify(item);
      if (!id || seen.has(id)) throw new Error("服务器分页出现重复或缺少 ID，已保留旧媒体库");
      seen.add(id);
    }
    offset += page.length;
    yield page;
  }
}
