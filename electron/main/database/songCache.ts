import type { TrackSource } from "@shared/types/player";
import { getDb } from "./index";

/** 单条记录 */
export interface SongCacheRow {
  cacheKey: string;
  source: TrackSource;
  filename: string;
  size: number;
  mime: string | null;
  cachedAt: number;
  lastUsedAt: number;
}

/** sqlite 原始行 */
interface RawRow {
  cache_key: string;
  source: TrackSource;
  filename: string;
  size: number;
  mime: string | null;
  cached_at: number;
  last_used_at: number;
}

/** sqlite snake_case 行 → 业务 camelCase */
const toRow = (raw: RawRow): SongCacheRow => ({
  cacheKey: raw.cache_key,
  source: raw.source,
  filename: raw.filename,
  size: raw.size,
  mime: raw.mime,
  cachedAt: raw.cached_at,
  lastUsedAt: raw.last_used_at,
});

/**
 * 按 key 查记录
 * @param cacheKey - 缓存键
 * @returns 记录
 */
export const findByKey = (cacheKey: string): SongCacheRow | null => {
  const raw = getDb().prepare("SELECT * FROM song_cache WHERE cache_key = ?").get(cacheKey) as
    | RawRow
    | undefined;
  return raw ? toRow(raw) : null;
};

/**
 * 按 filename 反查
 * @param filename - 文件名
 * @returns 记录
 */
export const findByFilename = (filename: string): SongCacheRow | null => {
  const raw = getDb().prepare("SELECT * FROM song_cache WHERE filename = ?").get(filename) as
    | RawRow
    | undefined;
  return raw ? toRow(raw) : null;
};

/**
 * 更新最近访问时间（命中 LRU）
 * @param cacheKey - 缓存键
 * @param now - 当前时间
 */
export const touchLastUsed = (cacheKey: string, now: number): void => {
  getDb().prepare("UPDATE song_cache SET last_used_at = ? WHERE cache_key = ?").run(now, cacheKey);
};

/**
 * 写入或覆盖一条记录
 * @param row - 记录
 */
export const upsert = (row: SongCacheRow): void => {
  getDb()
    .prepare(
      `INSERT INTO song_cache (cache_key, source, filename, size, mime, cached_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         source = excluded.source,
         filename = excluded.filename,
         size = excluded.size,
         mime = excluded.mime,
         cached_at = excluded.cached_at,
         last_used_at = excluded.last_used_at`,
    )
    .run(row.cacheKey, row.source, row.filename, row.size, row.mime, row.cachedAt, row.lastUsedAt);
};

/**
 * 删除一条
 * @param cacheKey - 缓存键
 */
export const deleteByKey = (cacheKey: string): void => {
  getDb().prepare("DELETE FROM song_cache WHERE cache_key = ?").run(cacheKey);
};

/**
 * 当前总占用字节数
 * @returns 总占用字节数
 */
export const totalSize = (): number => {
  const row = getDb().prepare("SELECT SUM(size) AS total FROM song_cache").get() as
    | { total: number | null }
    | undefined;
  return row?.total ?? 0;
};

/**
 * 列出全部 filename
 * @returns 文件名列表
 */
export const listAllFilenames = (): string[] => {
  const rows = getDb().prepare("SELECT filename FROM song_cache").all() as { filename: string }[];
  return rows.map((entry) => entry.filename);
};

/**
 * LRU 淘汰候选：按 last_used_at 升序取前 limit 条
 * @param limit - 限制数量
 * @returns 记录列表
 */
export const listLruVictims = (limit: number): SongCacheRow[] => {
  const rows = getDb()
    .prepare("SELECT * FROM song_cache ORDER BY last_used_at ASC LIMIT ?")
    .all(limit) as RawRow[];
  return rows.map(toRow);
};

/** 清空整张表 */
export const clearAll = (): void => {
  getDb().prepare("DELETE FROM song_cache").run();
};
