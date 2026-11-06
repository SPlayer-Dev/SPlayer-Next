/**
 * 动态封面匹配缓存
 *
 * 表：motion_cover_cache(fingerprint, video_url, matched_at)
 * fingerprint 为曲目指纹或 album / collection 前缀的专辑键，同专辑曲目借此跳过重复请求
 * video_url 为空表示未匹配到或专辑无动态封面，按较短 TTL 过期后重试
 */

import { getDb } from "./index";

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 读取未过期的匹配结果
 * @param fingerprint - 曲目指纹
 * @returns 视频主播放列表地址；null 表示已确认无动态封面；undefined 表示需要重新匹配
 */
export const getMotionCoverRecord = (fingerprint: string): string | null | undefined => {
  const row = getDb()
    .prepare("SELECT video_url, matched_at FROM motion_cover_cache WHERE fingerprint = ?")
    .get(fingerprint) as { video_url: string | null; matched_at: number } | undefined;
  if (!row) return undefined;
  const ttl = row.video_url ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - row.matched_at > ttl) return undefined;
  return row.video_url;
};

/**
 * 写入匹配结果
 * @param fingerprint - 曲目指纹
 * @param videoUrl - 视频主播放列表地址，无动态封面时为 null
 */
export const setMotionCoverRecord = (fingerprint: string, videoUrl: string | null): void => {
  getDb()
    .prepare(
      `INSERT INTO motion_cover_cache (fingerprint, video_url, matched_at) VALUES (?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         video_url = excluded.video_url,
         matched_at = excluded.matched_at`,
    )
    .run(fingerprint, videoUrl, Date.now());
};

/** 清空匹配缓存 */
export const clearMotionCoverCache = (): void => {
  getDb().prepare("DELETE FROM motion_cover_cache").run();
};
