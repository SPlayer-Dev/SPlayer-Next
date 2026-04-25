/**
 * fuzzy 匹配映射缓存
 *
 * 表：lyric_match_cache(fingerprint, platform, platform_id, matched_at) PK (fingerprint, platform)
 *
 * 作用：把 (track 指纹) → (某平台的 platform_id) 这步 fuzzy search 的结果持久化
 * 重启后再播同一首本地歌可跳过 search
 * TTL 30 天，过期视为 miss 重新匹配
 */

import { normalize } from "@main/apis/common/lyric/utils";
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import { getDb } from "./index";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 时长按 5s 桶归一，避免不同来源元数据微差导致 miss */
const DURATION_BUCKET_MS = 5000;

/** 用 title + 第一艺术家 + 时长桶 算 track 指纹 */
export const buildFingerprint = (track: Track): string => {
  const title = normalize(track.title);
  const artist = normalize(track.artists[0]?.name);
  const bucket = track.duration ? Math.round(track.duration / DURATION_BUCKET_MS) : 0;
  return `${title}|${artist}|${bucket}`;
};

/** 命中且未过期返回 platform_id；过期/未命中返回 null */
export const getMatchedId = (fingerprint: string, platform: Platform): string | null => {
  const row = getDb()
    .prepare(
      "SELECT platform_id, matched_at FROM lyric_match_cache WHERE fingerprint = ? AND platform = ?",
    )
    .get(fingerprint, platform) as { platform_id: string; matched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.matched_at > TTL_MS) return null;
  return row.platform_id;
};

/** upsert 映射；matched_at 每次写入都刷新 */
export const setMatchedId = (fingerprint: string, platform: Platform, platformId: string): void => {
  getDb()
    .prepare(
      `INSERT INTO lyric_match_cache (fingerprint, platform, platform_id, matched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(fingerprint, platform) DO UPDATE SET
         platform_id = excluded.platform_id,
         matched_at = excluded.matched_at`,
    )
    .run(fingerprint, platform, platformId, Date.now());
};

/** 清空全部映射缓存 */
export const clearLyricMatchCache = (): void => {
  getDb().prepare("DELETE FROM lyric_match_cache").run();
};
