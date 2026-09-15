import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { libraryLog } from "@main/utils/logger";
import { databaseDir } from "@main/utils/paths";
import { migrate } from "./migration";

/** 数据库文件路径 */
const dbPath = path.join(databaseDir, "library.db");

let db: Database.Database | null = null;

/** 获取数据库实例 */
export const getDb = (): Database.Database => {
  if (!db) throw new Error("Database not initialized");
  return db;
};

/** 数据库是否已打开 */
export const isDbOpen = (): boolean => db !== null;

/** 初始化数据库：打开连接、启用 WAL、建表建索引、执行迁移 */
export const initDatabase = (): void => {
  fs.mkdirSync(databaseDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // lyric_cache 是纯缓存表：如果老 DB 里的 schema 跟当前代码期望的不一致，直接丢重建
  const cols = db.prepare("PRAGMA table_info(lyric_cache)").all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "data")) {
    db.exec("DROP TABLE lyric_cache");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      cue_path TEXT,
      cue_audio_path TEXT,
      cue_start_ms INTEGER,
      cue_end_ms INTEGER,
      title TEXT NOT NULL,
      track INTEGER,
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

    CREATE TABLE IF NOT EXISTS account_sessions (
      platform TEXT PRIMARY KEY,
      cookies TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lyric_cache (
      platform TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (platform, platform_id)
    );

    CREATE TABLE IF NOT EXISTS lyric_match_cache (
      fingerprint TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      extra TEXT,
      matched_at INTEGER NOT NULL,
      PRIMARY KEY (fingerprint, platform)
    );

    CREATE TABLE IF NOT EXISTS lyric_ttml_cache (
      platform TEXT NOT NULL,
      id TEXT NOT NULL,
      content TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (platform, id)
    );

    CREATE TABLE IF NOT EXISTS song_cache (
      cache_key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      cached_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_song_cache_last_used ON song_cache(last_used_at);
    CREATE INDEX IF NOT EXISTS idx_song_cache_source ON song_cache(source);

    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      listened_ms INTEGER NOT NULL,
      track_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_play_history_started ON play_history(started_at);
    CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(source, track_id);

    CREATE TABLE IF NOT EXISTS favorite_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      at INTEGER NOT NULL,
      track_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_favorite_history_at ON favorite_history(at);

    CREATE TABLE IF NOT EXISTS download_tasks (
      task_id TEXT PRIMARY KEY,
      track_json TEXT NOT NULL,
      quality_level TEXT NOT NULL,
      status TEXT NOT NULL,
      received INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      error_code TEXT,
      tag_warning INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      custom_dir TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_download_tasks_created ON download_tasks(created_at);

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type = 'local'),
      title TEXT NOT NULL,
      description TEXT,
      cover TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_type
      ON playlists(type, updated_at DESC);

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position
      ON playlist_tracks(playlist_id, position);

    CREATE TABLE IF NOT EXISTS remote_tracks (
      server_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      data TEXT NOT NULL,
      title TEXT NOT NULL,
      search_text TEXT NOT NULL,
      generation INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, remote_id)
    );
    CREATE INDEX IF NOT EXISTS idx_remote_tracks_title
      ON remote_tracks(server_id, title);
    CREATE INDEX IF NOT EXISTS idx_remote_tracks_generation
      ON remote_tracks(server_id, generation);

    CREATE TABLE IF NOT EXISTS remote_albums (
      server_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      data TEXT NOT NULL,
      name TEXT NOT NULL,
      generation INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, remote_id)
    );
    CREATE INDEX IF NOT EXISTS idx_remote_albums_name
      ON remote_albums(server_id, name);
    CREATE INDEX IF NOT EXISTS idx_remote_albums_generation
      ON remote_albums(server_id, generation);

    CREATE TABLE IF NOT EXISTS remote_artists (
      server_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      data TEXT NOT NULL,
      name TEXT NOT NULL,
      generation INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, remote_id)
    );
    CREATE INDEX IF NOT EXISTS idx_remote_artists_name
      ON remote_artists(server_id, name);
    CREATE INDEX IF NOT EXISTS idx_remote_artists_generation
      ON remote_artists(server_id, generation);

    CREATE TABLE IF NOT EXISTS remote_playlists (
      server_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      data TEXT NOT NULL,
      name TEXT NOT NULL,
      generation INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, remote_id)
    );
    CREATE INDEX IF NOT EXISTS idx_remote_playlists_name
      ON remote_playlists(server_id, name);
    CREATE INDEX IF NOT EXISTS idx_remote_playlists_generation
      ON remote_playlists(server_id, generation);

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

export {
  getAllTracks,
  getTrackCount,
  getFileRecords,
  getCueTrackPathsByDirs,
  upsertTracks,
  deleteTracksByPaths,
  searchTracks,
  deleteTracksByDir,
  getAlbumList,
  getArtistList,
  getAlbumTracks,
  getArtistTracks,
  getTracksByIds,
  getRandomTrack,
  getRandomTracks,
  getLibraryStats,
} from "./queries";

export type { FileRecord, UpsertTrack } from "./queries";
