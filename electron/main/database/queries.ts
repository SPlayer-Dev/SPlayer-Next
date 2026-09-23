import path from "node:path";
import type { Track, Artist, Album, AudioQuality } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary } from "@shared/types/library";
import type { LibraryStats } from "@shared/types/stats";
import { getDb } from "./index";

/** 数据库行类型 */
interface TrackRow {
  id: string;
  path: string;
  cue_path: string | null;
  cue_audio_path: string | null;
  cue_start_ms: number | null;
  cue_end_ms: number | null;
  title: string;
  track?: number;
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
  file_mtime: number | null;
  file_ctime: number | null;
  scanned_at: number;
}

/** 将数据库行解析为 Track */
const rowToTrack = (row: TrackRow): Track => {
  const quality: AudioQuality | undefined =
    row.codec != null
      ? {
          codec: row.codec,
          sampleRate: row.sample_rate ?? 0,
          bitRate: row.bit_rate ?? 0,
          channels: row.channels ?? 0,
          bitsPerSample: row.bits_per_sample ?? 0,
        }
      : undefined;

  return {
    id: row.id,
    source: "local",
    path: row.path,
    cuePath: row.cue_path ?? undefined,
    cueAudioPath: row.cue_audio_path ?? undefined,
    cueStartMs: row.cue_start_ms ?? undefined,
    cueEndMs: row.cue_end_ms ?? undefined,
    title: row.title,
    track: row.track ?? undefined,
    artists: JSON.parse(row.artists) as Artist[],
    album: row.album ? (JSON.parse(row.album) as Album) : undefined,
    duration: row.duration,
    cover: row.cover ?? undefined,
    fileSize: row.file_size ?? undefined,
    mtime: row.file_mtime ?? undefined,
    ctime: row.file_ctime ?? undefined,
    quality,
  };
};

/** 查询全部曲目（含被 CUE 引用的容器整轨，供扫描器读取时长/封面等） */
export const getAllTracks = (): Track[] => {
  const rows = getDb().prepare("SELECT * FROM tracks").all() as TrackRow[];
  return rows.map(rowToTrack);
};

/**
 * 排除被 CUE 分轨引用的容器整轨文件的 WHERE 片段
 * 容器整轨（如整张原盘 flac）已被虚拟分轨取代，不应在曲库中重复出现
 * @param col - 外层曲目的 path 列（json_each 也有 path 列，带别名时须显式限定）
 */
const excludeCueContainer = (col = "path"): string =>
  `${col} NOT IN (SELECT cue_audio_path FROM tracks WHERE cue_audio_path IS NOT NULL)`;

/** 获取曲目总数（不含 CUE 容器整轨） */
export const getTrackCount = (): number => {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM tracks WHERE ${excludeCueContainer()}`)
    .get() as { count: number };
  return row.count;
};

/** 随机取一首曲目，库为空时返回 null */
export const getRandomTrack = (): Track | null => {
  const row = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT 1`)
    .get() as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
};

/** 随机取多首曲目 */
export const getRandomTracks = (limit: number): Track[] => {
  const safe = Math.max(0, Math.min(limit | 0, 500));
  if (safe === 0) return [];
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT ?`)
    .all(safe) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 用于增量扫描比对的文件记录 */
export interface FileRecord {
  path: string;
  mtime: number;
  size: number;
}

/** 获取所有真实音频文件记录（path + mtime + size），用于增量扫描比对 */
export const getFileRecords = (): FileRecord[] => {
  return getDb()
    .prepare(
      "SELECT path, COALESCE(file_mtime, 0) as mtime, file_size as size FROM tracks WHERE cue_path IS NULL",
    )
    .all() as FileRecord[];
};

/** 批量插入/更新的扫描结果 */
export interface UpsertTrack {
  id: string;
  path: string;
  cuePath?: string;
  cueAudioPath?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  title: string;
  track?: number;
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
  mtime: number;
  ctime: number;
}

/** 批量插入/更新曲目（使用事务） */
export const upsertTracks = (tracks: UpsertTrack[]): void => {
  if (tracks.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO tracks
      (id, path, cue_path, cue_audio_path, cue_start_ms, cue_end_ms, title, track, artists, album, duration, cover, codec, sample_rate, bit_rate, channels, bits_per_sample, file_size, file_mtime, file_ctime, scanned_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const tx = d.transaction(() => {
    for (const t of tracks) {
      stmt.run(
        t.id,
        t.path,
        t.cuePath ?? null,
        t.cueAudioPath ?? null,
        t.cueStartMs ?? null,
        t.cueEndMs ?? null,
        t.title,
        t.track ?? null,
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
        t.mtime,
        t.ctime,
        now,
      );
    }
  });
  tx();
};

/** 查询指定目录下的 CUE 虚拟曲目路径 */
export const getCueTrackPathsByDirs = (dirs: string[]): string[] => {
  if (dirs.length === 0) return [];
  const rows: { path: string }[] = [];
  const stmt = getDb().prepare("SELECT path FROM tracks WHERE cue_path LIKE ?");
  for (const dir of dirs) {
    const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
    rows.push(...(stmt.all(prefix + "%") as { path: string }[]));
  }
  return rows.map((row) => row.path);
};

/** 批量删除曲目（按路径） */
export const deleteTracksByPaths = (paths: string[]): void => {
  if (paths.length === 0) return;
  const d = getDb();
  const removeMemberships = d.prepare(
    `DELETE FROM playlist_tracks
     WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
       AND track_id IN (
         SELECT id FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?
       )`,
  );
  const stmt = d.prepare("DELETE FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?");
  const tx = d.transaction(() => {
    for (const p of paths) {
      removeMemberships.run(p, p, p);
      stmt.run(p, p, p);
    }
  });
  tx();
};

/** 模糊搜索曲目（title / artists / album） */
export const searchTracks = (query: string): Track[] => {
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks WHERE (title LIKE ? ESCAPE '\\' OR artists LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\') AND ${excludeCueContainer()}`,
    )
    .all(pattern, pattern, pattern) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 删除指定目录下的所有曲目 */
export const deleteTracksByDir = (dir: string): void => {
  const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
  const patterns = [prefix + "%", prefix + "%", prefix + "%"];
  const database = getDb();
  database.transaction(() => {
    database
      .prepare(
        `DELETE FROM playlist_tracks
         WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
           AND track_id IN (
             SELECT id FROM tracks WHERE path LIKE ? OR cue_path LIKE ? OR cue_audio_path LIKE ?
           )`,
      )
      .run(...patterns);
    database
      .prepare("DELETE FROM tracks WHERE path LIKE ? OR cue_path LIKE ? OR cue_audio_path LIKE ?")
      .run(...patterns);
  })();
};

/** 专辑列表 */
export const getAlbumList = (): AlbumSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT
         json_extract(album, '$.name') AS name,
         MAX(CASE WHEN cover IS NOT NULL THEN cover END) AS cover,
         MAX(artists) AS artists,
         COUNT(*) AS trackCount
       FROM tracks
       WHERE album IS NOT NULL AND json_extract(album, '$.name') IS NOT NULL
         AND ${excludeCueContainer()}
       GROUP BY name`,
    )
    .all() as { name: string; cover: string | null; artists: string; trackCount: number }[];
  return rows.map((row) => ({
    name: row.name,
    cover: row.cover ?? undefined,
    artist: (JSON.parse(row.artists) as Artist[]).map((a) => a.name).join(" / "),
    trackCount: row.trackCount,
  }));
};

/** 歌手列表 */
export const getArtistList = (): ArtistSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT
         json_extract(a.value, '$.name') AS name,
         COUNT(DISTINCT t.id) AS trackCount,
         MAX(CASE WHEN t.cover IS NOT NULL THEN t.cover END) AS cover
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}
       GROUP BY name`,
    )
    .all() as { name: string; trackCount: number; cover: string | null }[];
  return rows.map((row) => ({
    name: row.name,
    trackCount: row.trackCount,
    cover: row.cover ?? undefined,
  }));
};

/** 按专辑名获取全部曲目 */
export const getAlbumTracks = (albumName: string): Track[] => {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks WHERE json_extract(album, '$.name') = ? AND ${excludeCueContainer()}`,
    )
    .all(albumName) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 按歌手名获取全部曲目 */
export const getArtistTracks = (artistName: string): Track[] => {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT t.* FROM tracks t, json_each(t.artists) a
       WHERE LOWER(json_extract(a.value, '$.name')) = LOWER(?)
         AND ${excludeCueContainer("t.path")}`,
    )
    .all(artistName) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 音乐库统计概览：数量、总时长/大小与格式分布 */
export const getLibraryStats = (): LibraryStats => {
  const d = getDb();
  const aggregate = d
    .prepare(
      `SELECT COUNT(*) AS trackCount,
              COALESCE(SUM(duration), 0) AS totalDurationMs,
              COALESCE(SUM(file_size), 0) AS totalFileSize
       FROM tracks
       WHERE ${excludeCueContainer()}`,
    )
    .get() as { trackCount: number; totalDurationMs: number; totalFileSize: number };

  const albumRow = d
    .prepare(
      `SELECT COUNT(DISTINCT json_extract(album, '$.name')) AS count
       FROM tracks
       WHERE album IS NOT NULL AND json_extract(album, '$.name') IS NOT NULL
         AND ${excludeCueContainer()}`,
    )
    .get() as { count: number };

  const artistRow = d
    .prepare(
      `SELECT COUNT(DISTINCT json_extract(a.value, '$.name')) AS count
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}`,
    )
    .get() as { count: number };

  const codecs = d
    .prepare(
      `SELECT COALESCE(codec, '') AS codec, COUNT(*) AS count
       FROM tracks
       WHERE ${excludeCueContainer()}
       GROUP BY codec
       ORDER BY count DESC, codec`,
    )
    .all() as { codec: string; count: number }[];

  return {
    trackCount: aggregate.trackCount,
    albumCount: albumRow.count,
    artistCount: artistRow.count,
    totalDurationMs: aggregate.totalDurationMs,
    totalFileSize: aggregate.totalFileSize,
    codecs,
  };
};

/** 按 ID 批量获取曲目 */
export const getTracksByIds = (ids: string[]): Track[] => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`)
    .all(...ids) as TrackRow[];
  return rows.map(rowToTrack);
};
