import type { Track } from "@shared/types/player";
import { netease } from "@/apis/netease";

interface SongUrlItem {
  url: string | null;
  freeTrialInfo: unknown | null;
}

interface SongUrlResp {
  data?: SongUrlItem[];
}

/**
 * 调网易云 song_url v1 拿播放地址
 * @param track - 要解析的 track
 * @returns 解析出的播放地址，如果无法解析则返回 null
 * @param track 网易云 Track（track.id 为云端 songId）
 */
export const resolveNeteaseUrl = async (track: Track): Promise<string | null> => {
  const body = await netease.song_url<SongUrlResp>({
    id: track.id,
    level: "exhigh",
  });
  const item = body?.data?.[0];
  if (!item?.url || item.freeTrialInfo) return null;
  return item.url;
};
