/**
 * 歌词接口返回缓存
 *
 * 表：lyric_cache(platform, platform_id PK, data JSON, fetched_at)
 * - data 存整个 LyricMatchResult 序列化后字符串（含主歌词 + 翻译 + 罗马音的 raw 文本）
 * - 解析交给渲染端的 parseLyric，主进程只做"按平台主键 key-value"的透明缓存
 * - 7 天后重新请求，让平台后补或更新的歌词能被拿到；重新请求失败时沿用旧缓存
 */

import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { getDb } from "./index";

/** 缓存有效期 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 读取缓存行
 * @param platform - 平台
 * @param platformId - 平台歌曲主键
 * @returns 缓存内容与是否仍在有效期内，未命中返回 null
 */
const readCache = (
  platform: Platform,
  platformId: string,
): { result: LyricMatchResult; fresh: boolean } | null => {
  const row = getDb()
    .prepare("SELECT data, fetched_at FROM lyric_cache WHERE platform = ? AND platform_id = ?")
    .get(platform, platformId) as { data: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return {
      result: JSON.parse(row.data) as LyricMatchResult,
      fresh: Date.now() - row.fetched_at < TTL_MS,
    };
  } catch {
    return null;
  }
};

/**
 * 带缓存地获取歌词：有效期内直接命中，过期或未命中时调用 fetcher 并回写
 * @param platform - 平台
 * @param platformId - 平台歌曲主键
 * @param fetcher - 实际请求平台接口，失败返回 null
 * @returns 歌词结果，请求失败时回落到过期缓存
 */
export const withLyricCache = async (
  platform: Platform,
  platformId: string,
  fetcher: () => Promise<LyricMatchResult | null>,
): Promise<LyricMatchResult | null> => {
  const cached = readCache(platform, platformId);
  if (cached?.fresh) return cached.result;
  const result = await fetcher();
  if (!result) return cached?.result ?? null;
  getDb()
    .prepare(
      `INSERT INTO lyric_cache (platform, platform_id, data, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(platform, platform_id) DO UPDATE SET
         data = excluded.data,
         fetched_at = excluded.fetched_at`,
    )
    .run(platform, platformId, JSON.stringify(result), Date.now());
  return result;
};

/** 清空全部歌词缓存（给"存储管理"按钮用） */
export const clearLyricCache = (): void => {
  getDb().prepare("DELETE FROM lyric_cache").run();
};
