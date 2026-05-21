import type { Track } from "@shared/types/player";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks } from "@/utils/format/netease";

/** 每日推荐歌曲（每日 30 首，需登录） */
export const fetchDailySongs = async (): Promise<Track[]> => {
  const body = await neteaseApi.recommend_songs({ timestamp: Date.now() });
  return songsToTracks(body?.data?.dailySongs);
};
