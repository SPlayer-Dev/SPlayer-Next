import type { Track } from "@shared/types/player";
import type { ShuffleMode } from "@/stores/status";
import { shouldSkipDjTrack } from "@/utils/preset/djMode";

/** 候选歌曲计算上下文 */
export interface CandidateContext {
  playIndex: number;
  queue: readonly Track[];
  fmMode: boolean;
  fuckDjMode: boolean;
  shuffleMode: ShuffleMode;
}

/** 候选查找结果 */
export interface CandidateResult {
  track: Track;
  index: number;
}

/**
 * 计算下一首预载候选 Track
 * @param ctx - 计算上下文
 * @returns 候选 Track 及位置，不存在则返回 null
 */
export const getNextTrackCandidate = (ctx: CandidateContext): CandidateResult | null => {
  if (ctx.fmMode) return null;
  const len = ctx.queue.length;
  if (len <= 1) return null;
  // 随机模式到达队尾时不缓存
  if (ctx.shuffleMode === "on" && ctx.playIndex >= len - 1) return null;

  let candidateIndex = (ctx.playIndex + 1) % len;
  let count = 0;

  while (count < len) {
    // 随机模式跨过队尾不缓存
    if (ctx.shuffleMode === "on" && candidateIndex >= len) return null;
    const track = ctx.queue[candidateIndex];
    if (track) {
      if (!ctx.fuckDjMode || !shouldSkipDjTrack(track)) {
        return { track, index: candidateIndex };
      }
    }
    candidateIndex = ctx.shuffleMode === "on" ? candidateIndex + 1 : (candidateIndex + 1) % len;
    count++;
  }

  return null;
};
