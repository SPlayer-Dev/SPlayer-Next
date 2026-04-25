import type Database from "better-sqlite3";

/** 当前 schema 版本，每次新增迁移时递增 */
const SCHEMA_VERSION = 3;

type TableInfoRow = { name: string };

/** 判断表是否存在指定列 */
const hasColumn = (d: Database.Database, table: string, column: string): boolean => {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === column);
};

/**
 * 执行数据库版本迁移
 *
 * - fresh DB（user_version = 0 且 tracks 表不存在）直接标记最新版本
 * - 旧库按版本号依次迁移
 */
export const migrate = (d: Database.Database): void => {
  const version = d.pragma("user_version", { simple: true }) as number;

  // 新库：表刚由 CREATE TABLE IF NOT EXISTS 创建，无需迁移
  if (version === 0) {
    const row = d.prepare("SELECT COUNT(*) as cnt FROM tracks").get() as { cnt: number };
    if (row.cnt === 0) {
      d.pragma(`user_version = ${SCHEMA_VERSION}`);
      return;
    }
  }

  // 逐版本迁移
  let v = version;

  // v1 → v2: 添加 file_mtime / file_ctime 列
  if (v < 2) {
    if (!hasColumn(d, "tracks", "file_mtime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_mtime INTEGER");
    }
    if (!hasColumn(d, "tracks", "file_ctime")) {
      d.exec("ALTER TABLE tracks ADD COLUMN file_ctime INTEGER");
    }
    v = 2;
  }

  // v2 → v3: lyric_match_cache 加 extra 列（JSON 字符串），存平台额外字段
  if (v < 3) {
    if (!hasColumn(d, "lyric_match_cache", "extra")) {
      d.exec("ALTER TABLE lyric_match_cache ADD COLUMN extra TEXT");
    }
    v = 3;
  }

  if (v !== version) {
    d.pragma(`user_version = ${v}`);
  }
};
