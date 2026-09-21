import type { Track } from "@shared/types/player";

/** 模块级快照：进入评论页前暂存 Track，页面消费后清空，避免长期持有引用 */
let snapshot: Track | null = null;

/**
 * 设置评论页曲目快照
 * @param track - 进入评论页的曲目
 */
export const setCommentPageSnapshot = (track: Track): void => {
  snapshot = track;
};

/**
 * 消费评论页曲目快照（一次性，取后即空）
 * @returns 快照 Track 或 null
 */
export const consumeCommentPageSnapshot = (): Track | null => {
  const track = snapshot;
  snapshot = null;
  return track;
};
