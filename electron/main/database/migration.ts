import type Database from "better-sqlite3";

/** 当前 schema 版本 */
const SCHEMA_VERSION = 4;

type TableInfoRow = { name: string };

/** 判断表是否存在指定列 */
const hasColumn = (d: Database.Database, table: string, column: string): boolean => {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === column);
};

/** 执行数据库迁移 */
export const migrate = (d: Database.Database): void => {
  const version = d.pragma("user_version", { simple: true }) as number;
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

  // v2 → v3: 添加 track 列
  if (v < 3) {
    if (!hasColumn(d, "tracks", "track")) {
      d.exec("ALTER TABLE tracks ADD COLUMN track INTEGER");
    }
    v = 3;
  }

  // v3 → v4: 添加 CUE 分轨列
  if (v < 4) {
    if (!hasColumn(d, "tracks", "cue_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_audio_path")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_audio_path TEXT");
    }
    if (!hasColumn(d, "tracks", "cue_start_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_start_ms INTEGER");
    }
    if (!hasColumn(d, "tracks", "cue_end_ms")) {
      d.exec("ALTER TABLE tracks ADD COLUMN cue_end_ms INTEGER");
    }
    v = 4;
  }

  // 版本无关部分
  // 补 lyric_match_cache.extra 列
  if (!hasColumn(d, "lyric_match_cache", "extra")) {
    d.exec("ALTER TABLE lyric_match_cache ADD COLUMN extra TEXT");
  }

  if (v < SCHEMA_VERSION) v = SCHEMA_VERSION;
  if (v !== version) {
    d.pragma(`user_version = ${v}`);
  }
};
