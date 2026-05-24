/**
 * 私人 FM
 */

import type { Track } from "@shared/types/player";
import { fetchPersonalFm, dislikeFmTrack } from "@/apis/recommend/netease";

/** 剩余曲目不足此数时后台续推，FM 单次返回约 3 首 */
const FM_PREFETCH_AHEAD = 1;

let list: Track[] = [];
let index = 0;
/** 续推在途 promise，并发复用 */
let fetchingPromise: Promise<void> | null = null;

/** 当前 FM 曲目；池空返回 null */
export const current = (): Track | null => list[index] ?? null;

/** 池是否非空 */
export const hasTracks = (): boolean => list.length > index;

/** 拉一批新曲目追加到池末 */
const fetchMore = (): Promise<void> => {
  if (fetchingPromise) return fetchingPromise;
  fetchingPromise = (async () => {
    try {
      const more = await fetchPersonalFm();
      const seen = new Set(list.map((track) => track.id));
      const fresh = more.filter((track) => !seen.has(track.id));
      if (fresh.length > 0) list = [...list, ...fresh];
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
  if (list.length - index <= FM_PREFETCH_AHEAD) {
    void fetchMore();
  }
};

/** 进入 FM */
export const start = async (): Promise<Track | null> => {
  if (list.length === 0) await fetchMore();
  return current();
};

/** 推进到下一首 */
export const next = async (): Promise<Track | null> => {
  index++;
  maybeFetch();
  if (index >= list.length) {
    await fetchMore();
    if (index >= list.length) return null;
  }
  return current();
};

/** 减少推荐 */
export const dislikeCurrent = async (): Promise<Track | null> => {
  const track = current();
  if (!track) return null;
  // API 失败不阻塞推进
  dislikeFmTrack(track.id).catch((error) => console.error("[fm] 减少推荐失败:", error));
  list = [...list.slice(0, index), ...list.slice(index + 1)];
  maybeFetch();
  if (index >= list.length) {
    await fetchMore();
    if (index >= list.length) return null;
  }
  return current();
};
