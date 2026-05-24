/**
 * 私人 FM
 */

import type { Track } from "@shared/types/player";
import { fetchPersonalFm, submitFmTrash } from "@/apis/recommend/netease";

/** 剩余曲目不足此数时后台续推，FM 单次返回约 3 首 */
const FM_PREFETCH_AHEAD = 1;

let pool: Track[] = [];
/** 续推在途 promise，并发复用 */
let fetchingPromise: Promise<void> | null = null;

/** 当前 FM 曲目；池空返回 null */
export const current = (): Track | null => pool[0] ?? null;

/** 池是否非空 */
export const hasTracks = (): boolean => pool.length > 0;

/** 拉一批新曲目追加到池末 */
const fetchMore = (): Promise<void> => {
  if (fetchingPromise) return fetchingPromise;
  fetchingPromise = (async () => {
    try {
      const more = await fetchPersonalFm();
      const seen = new Set(pool.map((track) => track.id));
      const fresh = more.filter((track) => !seen.has(track.id));
      if (fresh.length > 0) pool = [...pool, ...fresh];
    } catch (error) {
      console.error("[fm] 拉取失败:", error);
    } finally {
      fetchingPromise = null;
    }
  })();
  return fetchingPromise;
};

/** 剩余曲目临近阈值时后台续推 */
const maybeFetch = (): void => {
  if (pool.length <= FM_PREFETCH_AHEAD) void fetchMore();
};

/** 弹出队头并保证剩余至少一首，无可用曲目返回 null */
const advance = async (): Promise<Track | null> => {
  pool = pool.slice(1);
  maybeFetch();
  if (pool.length === 0) {
    await fetchMore();
    if (pool.length === 0) return null;
  }
  return current();
};

/** 进入 FM */
export const start = async (): Promise<Track | null> => {
  if (pool.length === 0) await fetchMore();
  return current();
};

/** 推进到下一首 */
export const next = (): Promise<Track | null> => advance();

/**
 * 减少推荐
 * @param playedSec - 当前曲目已播放秒数，作为算法反馈
 */
export const dislikeCurrent = async (playedSec?: number): Promise<Track | null> => {
  const track = current();
  if (!track) return null;
  // API 失败不阻塞推进
  void submitFmTrash(track.id, playedSec).catch((error) =>
    console.error("[fm] 减少推荐失败:", error),
  );
  return advance();
};
