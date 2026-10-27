/**
 * 心动模式续推
 *
 * 与桌面端对齐：一轮队列每首至少播放一次后，先调用「更多推荐」接口取 3 首；
 * 接口不可用时退回心动模式智能播放列表。
 */

import type { Track } from "@shared/types/player";
import { fetchHeartModeList, fetchMoreHeartModeSongs } from "@/apis/recommend/netease";
import { firstPlayableId } from "@/utils/format/netease";
import * as queue from "@/stores/queue";
import { useStatusStore } from "@/stores/status";
import { useUserStore } from "@/stores/user";

/** 原生桌面端「更多推荐」每次追加的数量 */
const MORE_RCMD_BATCH_SIZE = 3;
/** 退回智能播放列表时最多追加的数量，避免一次灌入过多重复曲目 */
const FALLBACK_BATCH_SIZE = 10;

/** 续推在途 promise，并发复用 */
let fetchingPromise: Promise<Track[]> | null = null;

/**
 * 按当前歌曲续推一批曲目
 * @param currentTrack - 当前播放歌曲
 * @param songIds - 当前队列中的歌曲 id
 * @returns 推荐曲目；接口失败或未登录时为空数组
 */
const fetchMore = (currentTrack: Track, songIds: string[]): Promise<Track[]> => {
  if (fetchingPromise) return fetchingPromise;
  const user = useUserStore();
  const request = (async () => {
    if (songIds.length > 0) {
      try {
        const { tracks, algMap } = await fetchMoreHeartModeSongs(songIds, currentTrack.id);
        if (tracks.length > 0) {
          return tracks.slice(0, MORE_RCMD_BATCH_SIZE).map((track) => ({
            ...track,
            moreRcmd: true,
            ...(algMap[track.id] ? { algorithm: algMap[track.id] } : {}),
          }));
        }
      } catch (error) {
        console.warn("[heartMode] 更多推荐接口不可用，回退智能播放列表:", error);
      }
    }
    const playlistId = user.likedPlaylistId;
    if (!playlistId) return [];
    const liked = user.likedPlaylistTracks;
    const tracks = await fetchHeartModeList(currentTrack.id, playlistId, {
      type: "fromPlayAll",
      count: Math.max(liked.length, user.likedSongIds.size, 1),
      startMusicId: firstPlayableId(liked) ?? currentTrack.id,
      starPlaylist: liked,
      uid: user.profile?.userId,
    });
    return tracks.slice(0, FALLBACK_BATCH_SIZE);
  })()
    .catch((error) => {
      console.error("[heartMode] 续推失败:", error);
      return [];
    })
    .finally(() => {
      if (fetchingPromise === request) fetchingPromise = null;
    });
  fetchingPromise = request;
  return request;
};

/**
 * 按当前歌曲续推一批曲目并追加到队列末尾
 * @param currentTrack - 当前播放歌曲
 * @returns 实际追加的曲目数
 */
export const extendQueue = async (currentTrack: Track): Promise<number> => {
  const status = useStatusStore();
  if (!status.heartMode || !status.heartModeWantMore) return 0;
  const generationBefore = queue.queueGeneration.value;
  const songIds = queue.queue.value
    .filter((track) => track.source === "netease" && Boolean(track.id))
    .map((track) => track.id);
  const tracks = await fetchMore(currentTrack, songIds);
  // 请求期间关闭自动续推、退出心动模式或队列被整体替换，放弃本批推荐；正常切歌不影响
  if (
    !status.heartMode ||
    !status.heartModeWantMore ||
    queue.queueGeneration.value !== generationBefore
  ) {
    return 0;
  }
  if (tracks.length === 0) return 0;
  const seen = new Set(queue.queue.value.map((track) => track.id));
  const fresh = tracks.filter((track) => !seen.has(track.id));
  if (fresh.length === 0) return 0;
  queue.insertManyToQueue(fresh, queue.queueLength.value);
  return fresh.length;
};
