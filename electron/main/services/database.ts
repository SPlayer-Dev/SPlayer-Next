import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import { libraryLog } from "../utils/logger";
import type { Track, Artist, Album } from "@shared/types/player";

/** 数据库文件路径（放在 Database 子目录，避免 userData 根目录杂乱） */
const dbDir = path.join(app.getPath("userData"), "Database");
const dbPath = path.join(dbDir, "library.db");

let db: Database.Database | null = null;

/** 初始化数据库：打开连接、启用 WAL、建表建索引 */
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
      file_mtime INTEGER NOT NULL,
      scanned_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
  `);
  libraryLog.info(`数据库已初始化: ${dbPath}`);
};

/** 获取数据库实例 */
const getDb = (): Database.Database => {
  if (!db) throw new Error("Database not initialized");
  return db;
};

/** 关闭数据库连接 */
export const closeDatabase = (): void => {
  if (db) {
    db.close();
    db = null;
    libraryLog.info("数据库已关闭");
  }
};

/** 数据库行类型 */
interface TrackRow {
  id: string;
  path: string;
  title: string;
  artists: string;
  album: string | null;
  duration: number;
  cover: string | null;
  codec: string | null;
  sample_rate: number | null;
  bit_rate: number | null;
  channels: number | null;
  bits_per_sample: number | null;
  file_size: number;
  file_mtime: number;
  scanned_at: number;
}

/** 将数据库行解析为 Track */
const rowToTrack = (row: TrackRow): Track => ({
  id: row.id,
  source: "local",
  path: row.path,
  title: row.title,
  artists: JSON.parse(row.artists) as Artist[],
  album: row.album ? (JSON.parse(row.album) as Album) : undefined,
  duration: row.duration,
  cover: row.cover ?? undefined,
});

/** 查询全部曲目 */
export const getAllTracks = (): Track[] => {
  const rows = getDb().prepare("SELECT * FROM tracks ORDER BY title").all() as TrackRow[];
  return rows.map(rowToTrack);
};


/** 获取曲目总数 */
export const getTrackCount = (): number => {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM tracks").get() as { count: number };
  return row.count;
};

/** 用于增量扫描比对的文件记录 */
export interface FileRecord {
  path: string;
  mtime: number;
  size: number;
}

/** 获取所有文件记录（path + mtime + size），用于增量扫描比对 */
export const getFileRecords = (): FileRecord[] => {
  return getDb()
    .prepare("SELECT path, file_mtime as mtime, file_size as size FROM tracks")
    .all() as FileRecord[];
};

/** 批量插入/更新的扫描结果（从 Rust 回调转换后） */
export interface UpsertTrack {
  id: string;
  path: string;
  title: string;
  artists: Artist[];
  album?: Album;
  duration: number;
  cover?: string;
  codec?: string;
  sampleRate?: number;
  bitRate?: number;
  channels?: number;
  bitsPerSample?: number;
  fileSize: number;
  fileMtime: number;
}

/** 批量插入/更新曲目（使用事务） */
export const upsertTracks = (tracks: UpsertTrack[]): void => {
  if (tracks.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO tracks
      (id, path, title, artists, album, duration, cover, codec, sample_rate, bit_rate, channels, bits_per_sample, file_size, file_mtime, scanned_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const tx = d.transaction(() => {
    for (const t of tracks) {
      stmt.run(
        t.id,
        t.path,
        t.title,
        JSON.stringify(t.artists),
        t.album ? JSON.stringify(t.album) : null,
        t.duration,
        t.cover ?? null,
        t.codec ?? null,
        t.sampleRate ?? null,
        t.bitRate ?? null,
        t.channels ?? null,
        t.bitsPerSample ?? null,
        t.fileSize,
        t.fileMtime,
        now,
      );
    }
  });
  tx();
};

/** 批量删除曲目（按路径） */
export const deleteTracksByPaths = (paths: string[]): void => {
  if (paths.length === 0) return;
  const d = getDb();
  const stmt = d.prepare("DELETE FROM tracks WHERE path = ?");
  const tx = d.transaction(() => {
    for (const p of paths) {
      stmt.run(p);
    }
  });
  tx();
};

/** 模糊搜索曲目（title / artists / album） */
export const searchTracks = (query: string): Track[] => {
  const pattern = `%${query}%`;
  const rows = getDb()
    .prepare(
      "SELECT * FROM tracks WHERE title LIKE ? OR artists LIKE ? OR album LIKE ? ORDER BY title",
    )
    .all(pattern, pattern, pattern) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 删除指定目录下的所有曲目 */
export const deleteTracksByDir = (dir: string): void => {
  // 确保目录以路径分隔符结尾，避免匹配到同前缀的其他目录
  const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
  getDb().prepare("DELETE FROM tracks WHERE path LIKE ?").run(prefix + "%");
};
