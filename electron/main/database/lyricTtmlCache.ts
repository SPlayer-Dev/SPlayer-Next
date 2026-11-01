/**
 * TTML 歌词缓存（来自 AMLL TTML DB）
 *
 * 表：lyric_ttml_cache(platform, id, content, fetched_at) PK (platform, id)
 *
 * - id：NCM 用 netease 数字 id；QM 用 mid
 * - content：TTML 文本，NULL 表示负缓存（DB 没有这首）
 * - 正缓存 7 天、负缓存 72h 后重新请求：按平台 ID 查询的结果会随词库更新变化
 */

import { getDb } from "./index";

/** 正缓存有效期 */
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 负缓存有效期 */
const NEGATIVE_TTL_MS = 72 * 60 * 60 * 1000;

export type Platform = "netease" | "qqmusic";

/**
 * 读取缓存行
 * @param platform - 平台
 * @param id - 平台歌曲 ID
 * @returns content 为 null 表示负缓存；fresh 表示仍在有效期内；未命中返回 null
 */
export const getCachedTTML = (
  platform: Platform,
  id: string,
): { content: string | null; fresh: boolean } | null => {
  const row = getDb()
    .prepare("SELECT content, fetched_at FROM lyric_ttml_cache WHERE platform = ? AND id = ?")
    .get(platform, id) as { content: string | null; fetched_at: number } | undefined;
  if (!row) return null;
  const ttl = row.content === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
  return { content: row.content, fresh: Date.now() - row.fetched_at < ttl };
};

/** upsert TTML；content 为 null 表示负缓存 */
export const setCachedTTML = (platform: Platform, id: string, content: string | null): void => {
  getDb()
    .prepare(
      `INSERT INTO lyric_ttml_cache (platform, id, content, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(platform, id) DO UPDATE SET
         content = excluded.content,
         fetched_at = excluded.fetched_at`,
    )
    .run(platform, id, content, Date.now());
};

/** 清空全部 TTML 缓存 */
export const clearLyricTtmlCache = (): void => {
  getDb().prepare("DELETE FROM lyric_ttml_cache").run();
};
