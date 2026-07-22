import type { MusicCommentItem } from "@shared/types/comment";

export const appendUniqueComments = (
  current: readonly MusicCommentItem[],
  incoming: readonly MusicCommentItem[],
): MusicCommentItem[] => {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id) && ids.add(item.id))];
};

export const hasNextCommentPage = (
  loadedCount: number,
  total: number,
  receivedCount: number,
  limit = 20,
): boolean => receivedCount === limit && loadedCount < total;
