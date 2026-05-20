import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks } from "@/utils/format/netease";

/**
 * 按 ID 批量取歌曲详情
 * @param ids - 网易云 songId 列表
 * @returns 与传入 ids 对应的 Track 列表
 */
export const songsByIds = async (ids: Array<string | number>): Promise<Track[]> => {
  const cleaned = ids.map((v) => String(v).trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const body = await neteaseApi.song_detail({ ids: cleaned.join(",") });
  return songsToTracks(body?.songs);
};

/** 项目音质档位 → 网易云 song/url v1 的 level 参数 */
const NETEASE_LEVEL: Record<QualityLevel, string> = {
  lq: "standard",
  sq: "higher",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
};

/**
 * 解析网易云 Track 的可播放 URL
 * VIP 试听片段 / 无版权 → 返回 null
 * @param track - track.id 为云端 songId
 * @param songLevel - 音质偏好；实际可用级别取决于账号权限
 */
export const resolveNeteaseUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<string | null> => {
  const body = await neteaseApi.song_url({ id: track.id, level: NETEASE_LEVEL[songLevel] });
  const item = body?.data?.[0];
  if (!item?.url || item.freeTrialInfo) return null;
  return item.url;
};
