import type { Track } from "@shared/types/player";

/** 进入评论页前暂存曲目，页面消费后立即清空，避免长期持有引用 */
let snapshot: Track | null = null;

/**
 * 设置评论页曲目快照
 * @param track - 进入评论页的曲目
 */
export const setCommentPageSnapshot = (track: Track): void => {
  snapshot = track;
};

/**
 * 消费评论页曲目快照，取后即空
 * @returns 快照曲目，没有快照时返回 null
 */
export const consumeCommentPageSnapshot = (): Track | null => {
  const track = snapshot;
  snapshot = null;
  return track;
};
