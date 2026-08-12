import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import type { QualityLevel } from "@/utils/quality";
import { netease as neteaseApi, neteaseCall } from "@/apis/netease";
import { isExplicitNeteaseAuthFailure } from "@/apis/neteaseAuth";
import { songsToTracks } from "@/utils/format/netease";

/**
 * 按 ID 批量取歌曲详情
 * @param ids - 平台 songId 列表
 * @returns 与传入 ids 对应的 Track 列表
 */
export const songsByIds = async (ids: Array<string | number>): Promise<Track[]> => {
  const cleaned = ids.map((v) => String(v).trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const body = await neteaseApi.song_detail({ ids: cleaned.join(",") });
  return songsToTracks(body?.songs);
};

/** 项目音质档位 → 官方 song/url v1 的 level 参数 */
const NETEASE_LEVEL: Record<QualityLevel, string> = {
  lq: "standard",
  sq: "higher",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
};

export type NeteasePlayUrlResult =
  { available: true; url: string; isTrial: boolean } | { available: false; errorCode: ErrorCode };

export interface NeteaseSessionRecovery {
  /** 发起请求前是否处于登录状态 */
  authenticated: boolean;
  /** 实时校验登录状态 */
  validate: () => Promise<boolean>;
}

/**
 * 分类官方播放地址响应
 * @param item - song/url 返回的单曲数据
 * @returns 可播放地址或明确的不可播放原因
 */
export const classifyNeteasePlayUrl = (item: unknown): NeteasePlayUrlResult => {
  if (!item || typeof item !== "object") {
    return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
  }
  const data = item as { url?: unknown; freeTrialInfo?: unknown; fee?: unknown };
  if (typeof data.url === "string" && data.url) {
    return { available: true, url: data.url, isTrial: data.freeTrialInfo != null };
  }
  const fee = Number(data.fee);
  if (fee === 1 || fee === 4) {
    return { available: false, errorCode: ErrorCode.NETEASE_VIP_REQUIRED };
  }
  return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
};

/**
 * 解析 Track 的播放 URL
 * @param track - track.id 为云端 songId
 * @param songLevel - 音质偏好；实际可用级别取决于账号权限
 * @param recovery - 登录失效时的确认与恢复方法
 * @returns 播放地址解析结果
 */
export const resolveNeteaseUrl = async (
  track: Track,
  songLevel: QualityLevel,
  recovery?: NeteaseSessionRecovery,
): Promise<NeteasePlayUrlResult> => {
  const request = async (): Promise<NeteasePlayUrlResult> => {
    const body = await neteaseCall<{ data?: unknown[] }>(
      "song_url",
      { id: track.id, level: NETEASE_LEVEL[songLevel] },
      { notifyAuthFailure: false },
    );
    return classifyNeteasePlayUrl(body?.data?.[0]);
  };

  let result: NeteasePlayUrlResult | null = null;
  let authFailure = false;
  try {
    result = await request();
  } catch (err) {
    const failure = err as { status?: number; body?: unknown; message?: string };
    if (!recovery || !isExplicitNeteaseAuthFailure(failure)) throw err;
    authFailure = true;
  }

  const shouldValidate = authFailure || (recovery?.authenticated && !result?.available);
  if (!recovery || !shouldValidate) return result!;

  const stillAuthenticated = await recovery.validate();
  if (!authFailure && stillAuthenticated) return result!;

  try {
    result = await request();
  } catch (err) {
    if (!stillAuthenticated && recovery.authenticated) {
      return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
    }
    throw err;
  }
  if (!stillAuthenticated && recovery.authenticated && !result.available) {
    return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
  }
  return result;
};

/** 下载源（带格式与体积） */
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
 * 解析 Track 的官方下载源
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
