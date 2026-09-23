import type {
  LegacyPlaylistRecord,
  PlaylistCreateInput,
  PlaylistDetail,
  PlaylistType,
  PlaylistSummary,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import { getDb } from "@main/database";
import { getTracksByIds } from "@main/database/queries";

interface PlaylistRow {
  id: string;
  type: PlaylistType;
  title: string;
  description: string | null;
  cover: string | null;
  track_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * 转换数据库歌单记录
 * @param row - 数据库查询结果
 * @returns renderer 可用的歌单列表项
 */
const toSummary = (row: PlaylistRow): PlaylistSummary => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description ?? undefined,
  cover: row.cover ?? undefined,
  trackCount: row.track_count,
  createTime: row.created_at,
  updateTime: row.updated_at,
});

const SELECT_PLAYLIST = `
  SELECT
    p.id,
    p.type,
    p.title,
    p.description,
    p.cover,
    p.created_at,
    p.updated_at,
    COUNT(pt.track_id) AS track_count
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
`;

/** 获取全部歌单列表 */
export const getPlaylists = (): PlaylistSummary[] => {
  const rows = getDb()
    .prepare(
      `${SELECT_PLAYLIST} WHERE p.type = 'local' GROUP BY p.id ORDER BY p.created_at DESC, p.id`,
    )
    .all() as PlaylistRow[];
  return rows.map(toSummary);
};

/**
 * 获取歌单详情
 * @param id - 歌单 ID
 * @returns 歌单及有序歌曲
 */
export const getPlaylist = (id: string): PlaylistDetail | null => {
  const row = getDb()
    .prepare(`${SELECT_PLAYLIST} WHERE p.id = ? AND p.type = 'local' GROUP BY p.id`)
    .get(id) as PlaylistRow | undefined;
  if (!row) return null;
  const trackIds = getDb()
    .prepare(
      `SELECT pt.track_id
       FROM playlist_tracks pt
       INNER JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position, pt.added_at, pt.track_id`,
    )
    .all(id) as { track_id: string }[];
  const fetched = getTracksByIds(trackIds.map((item) => item.track_id));
  const byId = new Map(fetched.map((track) => [track.id, track]));
  return {
    ...toSummary(row),
    tracks: trackIds.flatMap((item) => {
      const track = byId.get(item.track_id);
      return track ? [track] : [];
    }),
  };
};

/**
 * 创建歌单
 * @param input - 歌单信息
 * @returns 新歌单
 */
export const createPlaylist = (input: PlaylistCreateInput): PlaylistSummary => {
  const title = input.title.trim();
  if (!title) throw new Error("歌单名称不能为空");
  if (input.type !== "local") throw new Error("歌单类型无效");
  const now = Date.now();
  const id = `pl_${crypto.randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO playlists
        (id, type, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.type, title, input.description?.trim() || null, now, now);
  return getPlaylists().find((playlist) => playlist.id === id)!;
};

/**
 * 更新歌单信息
 * @param id - 歌单 ID
 * @param input - 更新内容
 * @returns 更新后的歌单
 */
export const updatePlaylist = (id: string, input: PlaylistUpdateInput): PlaylistSummary | null => {
  const current = getPlaylists().find((playlist) => playlist.id === id);
  if (!current) return null;
  const title = input.title?.trim() ?? current.title;
  if (!title) throw new Error("歌单名称不能为空");
  getDb()
    .prepare(
      `UPDATE playlists
       SET title = ?, description = ?, cover = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      title,
      input.description === undefined ? (current.description ?? null) : input.description || null,
      input.cover === undefined ? (current.cover ?? null) : input.cover || null,
      Date.now(),
      id,
    );
  return getPlaylists().find((playlist) => playlist.id === id) ?? null;
};

/**
 * 删除歌单
 * @param id - 歌单 ID
 */
export const deletePlaylist = (id: string): void => {
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(id);
    getDb().prepare("DELETE FROM playlists WHERE id = ?").run(id);
  })();
};

/**
 * 添加本地歌曲到歌单
 * @param id - 歌单 ID
 * @param trackIds - 本地歌曲 ID
 * @returns 实际新增数量
 */
export const addPlaylistTracks = (id: string, trackIds: string[]): number => {
  const playlist = getPlaylists().find((item) => item.id === id);
  if (!playlist || playlist.type !== "local") return 0;
  const uniqueIds = [...new Set(trackIds)];
  if (uniqueIds.length === 0) return 0;
  const database = getDb();
  return database.transaction(() => {
    const existing = database
      .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?")
      .all(id) as { track_id: string }[];
    const existingIds = new Set(existing.map((item) => item.track_id));
    const validIds = uniqueIds.filter((trackId) => {
      if (existingIds.has(trackId)) return false;
      return Boolean(database.prepare("SELECT 1 FROM tracks WHERE id = ?").get(trackId));
    });
    if (validIds.length === 0) return 0;
    database
      .prepare("UPDATE playlist_tracks SET position = position + ? WHERE playlist_id = ?")
      .run(validIds.length, id);
    const insert = database.prepare(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
       VALUES (?, ?, ?, ?)`,
    );
    const now = Date.now();
    validIds.forEach((trackId, position) => insert.run(id, trackId, position, now));
    const coverRow = database
      .prepare(
        `SELECT cover FROM tracks WHERE id IN (${validIds.map(() => "?").join(",")}) AND cover IS NOT NULL LIMIT 1`,
      )
      .get(...validIds) as { cover?: string } | undefined;
    database
      .prepare("UPDATE playlists SET cover = COALESCE(?, cover), updated_at = ? WHERE id = ?")
      .run(coverRow?.cover ?? null, now, id);
    return validIds.length;
  })();
};

/**
 * 从本地歌单移除歌曲
 * @param id - 歌单 ID
 * @param trackIds - 歌曲 ID
 */
export const removePlaylistTracks = (id: string, trackIds: string[]): number => {
  const playlist = getPlaylists().find((item) => item.id === id);
  if (!playlist || playlist.type !== "local") return 0;
  const ids = [...new Set(trackIds)];
  if (ids.length === 0) return 0;
  const database = getDb();
  return database.transaction(() => {
    const removed = database
      .prepare(
        `DELETE FROM playlist_tracks
         WHERE playlist_id = ? AND track_id IN (${ids.map(() => "?").join(",")})`,
      )
      .run(id, ...ids).changes;
    if (removed === 0) return 0;
    const remaining = database
      .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position")
      .all(id) as { track_id: string }[];
    const updatePosition = database.prepare(
      "UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?",
    );
    remaining.forEach((item, position) => updatePosition.run(position, id, item.track_id));
    database
      .prepare(
        "UPDATE playlists SET cover = CASE WHEN ? = 0 THEN NULL ELSE cover END, updated_at = ? WHERE id = ?",
      )
      .run(remaining.length, Date.now(), id);
    return removed;
  })();
};

/**
 * 导入旧版 renderer 本地歌单
 * @param records - IndexedDB 歌单记录
 */
export const importLegacyPlaylists = (records: LegacyPlaylistRecord[]): void => {
  if (records.length === 0) return;
  const database = getDb();
  database.transaction(() => {
    const insertPlaylist = database.prepare(
      `INSERT OR IGNORE INTO playlists
        (id, type, title, description, cover, created_at, updated_at)
       VALUES (?, 'local', ?, ?, ?, ?, ?)`,
    );
    const insertTrack = database.prepare(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tracks WHERE id = ?)`,
    );
    const now = Date.now();
    for (const record of records) {
      const createdAt = record.createTime ?? now;
      const updatedAt = record.updateTime ?? createdAt;
      insertPlaylist.run(
        record.id,
        record.title,
        record.description ?? null,
        record.cover ?? null,
        createdAt,
        updatedAt,
      );
      record.trackIds.forEach((trackId, position) =>
        insertTrack.run(record.id, trackId, position, updatedAt, trackId),
      );
    }
  })();
};

/** 清空全部歌单及歌曲关系 */
export const clearPlaylists = (): void => {
  const database = getDb();
  database.transaction(() => {
    database.prepare("DELETE FROM playlist_tracks").run();
    database.prepare("DELETE FROM playlists").run();
  })();
};
