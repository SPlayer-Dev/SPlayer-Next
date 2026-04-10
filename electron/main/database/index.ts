import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import { libraryLog } from "@main/utils/logger";
import { migrate } from "./migration";

/** 数据库文件路径 */
const dbDir = path.join(app.getPath("userData"), "Database");
const dbPath = path.join(dbDir, "library.db");

let db: Database.Database | null = null;

/** 获取数据库实例 */
export const getDb = (): Database.Database => {
  if (!db) throw new Error("Database not initialized");
  return db;
};

/** 初始化数据库：打开连接、启用 WAL、建表建索引、执行迁移 */
export const initDatabase = (): void => {
  fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artists TEXT NOT NULL DEFAULT '[]',
      album TEXT,
      duration INTEGER NOT NULL,
      cover TEXT,
      codec TEXT,
      sample_rate INTEGER,
      bit_rate INTEGER,
      channels INTEGER,
      bits_per_sample INTEGER,
      file_size INTEGER NOT NULL,
      file_mtime INTEGER,
      file_ctime INTEGER,
      scanned_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
  `);
  migrate(db);
  libraryLog.info(`数据库已初始化: ${dbPath}`);
};

/** 关闭数据库连接 */
export const closeDatabase = (): void => {
  if (db) {
    db.close();
    db = null;
    libraryLog.info("数据库已关闭");
  }
};

// 导出查询方法，保持外部导入路径不变
export {
  getAllTracks,
  getTrackCount,
  getFileRecords,
  upsertTracks,
  deleteTracksByPaths,
  searchTracks,
  deleteTracksByDir,
} from "./queries";

export type { FileRecord, UpsertTrack } from "./queries";
