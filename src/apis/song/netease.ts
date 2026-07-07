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

export interface NeteasePlayUrlResult {
  url: string;
  isTrial: boolean;
}

/**
 * 解析网易云 Track 的可播放 URL
 * @param track - track.id 为云端 songId
 * @param songLevel - 音质偏好；实际可用级别取决于账号权限
 */
export const resolveNeteaseUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<NeteasePlayUrlResult | null> => {
  const body = await neteaseApi.song_url({ id: track.id, level: NETEASE_LEVEL[songLevel] });
  const item = body?.data?.[0];
  if (!item?.url) return null;
  return { url: item.url, isTrial: !!item.freeTrialInfo };
};

/** 网易云下载源（带格式与体积） */
export interface NeteaseDownloadSource {
  url: string;
  /** 文件格式（flac/mp3 等） */
  format?: string;
  /** 体积（字节） */
  size?: number;
}

/** 官方下载接口（客户端下载，占用每日下载次数）；data 为单对象 */
const fetchNeteaseDownloadSource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_download_url({ id, level });
    const item = body?.data;
    if (!item?.url) return null;
    return { url: item.url, format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/** 播放接口（不占用下载次数）；data 为数组、可能是试听片段 */
const fetchNeteasePlaySource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_url({ id, level });
    const item = body?.data?.[0];
    if (!item?.url || item.freeTrialInfo) return null;
    return { url: item.url, format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/**
 * 解析网易云 Track 的下载源
 * 默认走官方下载接口（客户端下载），无果时回落播放接口；
 * 「模拟播放下载」开启时只用播放接口，避免占用每日下载次数。
 * @param track - track.id 为 songId
 * @param songLevel - 下载音质
 * @param usePlayback - 模拟播放下载：跳过下载接口、直接用播放接口
 * @returns 下载源（带格式与体积）；试听 / 无版权返回 null
 */
export const resolveNeteaseDownloadUrl = async (
  track: Track,
  songLevel: QualityLevel,
  usePlayback = false,
): Promise<NeteaseDownloadSource | null> => {
  const level = NETEASE_LEVEL[songLevel];
  if (!usePlayback) {
    const downloaded = await fetchNeteaseDownloadSource(track.id, level);
    if (downloaded) return downloaded;
  }
  return fetchNeteasePlaySource(track.id, level);
};
