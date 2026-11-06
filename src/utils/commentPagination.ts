import type { MusicCommentItem, MusicCommentPage } from "@shared/types/comment";

/**
 * 合并两段评论并去重，保持先后顺序
 * @param current - 已加载的评论
 * @param incoming - 新一页评论
 * @returns 去重合并后的评论列表
 */
export const appendUniqueComments = (
  current: readonly MusicCommentItem[],
  incoming: readonly MusicCommentItem[],
): MusicCommentItem[] => {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id) && Boolean(ids.add(item.id)))];
};

/**
 * 判断评论是否还有下一页
 * 来源给出 hasMore 时以其为准，否则用本页条数与已知总数推断
 * @param page - 本次返回的分页数据
 * @param loadedCount - 去重合并后的已加载总数
 * @returns 是否还有下一页
 */
export const hasNextCommentPage = (page: MusicCommentPage, loadedCount: number): boolean => {
  if (page.hasMore !== undefined) return page.hasMore;
  if (page.list.length < page.limit) return false;
  return page.total <= 0 || loadedCount < page.total;
};
