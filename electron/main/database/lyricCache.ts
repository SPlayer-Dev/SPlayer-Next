/**
 * 歌词接口返回缓存
 *
 * 表：lyric_cache(platform, platform_id PK, data JSON, fetched_at)
 * - data 存整个 LyricMatchResult 序列化后字符串（含主歌词 + 翻译 + 罗马音的 raw 文本）
 * - 解析交给渲染端的 parseLyric，主进程只做"按平台主键 key-value"的透明缓存
 *
 * 清理策略：暂不做 TTL，依赖"设置→存储管理"里的"清空歌词缓存"按钮手动触发
 */

import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { getDb } from "./index";

/** 按 (platform, platformId) 命中原始接口返回，未命中返回 null */
export const getCachedLyric = (platform: Platform, platformId: string): LyricMatchResult | null => {
  const row = getDb()
    .prepare("SELECT data FROM lyric_cache WHERE platform = ? AND platform_id = ?")
    .get(platform, platformId) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as LyricMatchResult;
  } catch {
    return null;
  }
};

/** upsert 原始接口返回；fetched_at 每次写入都刷新 */
export const setCachedLyric = (
  platform: Platform,
  platformId: string,
  result: LyricMatchResult,
): void => {
  getDb()
    .prepare(
      `INSERT INTO lyric_cache (platform, platform_id, data, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(platform, platform_id) DO UPDATE SET
         data = excluded.data,
         fetched_at = excluded.fetched_at`,
    )
    .run(platform, platformId, JSON.stringify(result), Date.now());
};

/** 清空全部歌词缓存（给"存储管理"按钮用） */
export const clearLyricCache = (): void => {
  getDb().prepare("DELETE FROM lyric_cache").run();
};
