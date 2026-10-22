import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import { getDb } from "@main/database";
import { upsertTracks, deleteStaleTracks } from "@main/database/streaming/tracks";
import { upsertAlbums, deleteStaleAlbums } from "@main/database/streaming/albums";
import { upsertArtists, deleteStaleArtists } from "@main/database/streaming/artists";
import { upsertPlaylists, deleteStalePlaylists } from "@main/database/streaming/playlists";

type Entry = Track | Album | Artist | Playlist;
type Kind = "songs" | "albums" | "artists" | "playlists";

/** 初始化连接级临时暂存表，实际数据随任务完成释放 */
const ensureStageTables = (): void => {
  getDb().exec(`CREATE TEMP TABLE IF NOT EXISTS streaming_stage (
    server_id TEXT NOT NULL, kind TEXT NOT NULL, remote_id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (server_id, kind, remote_id));
    CREATE TEMP TABLE IF NOT EXISTS streaming_stage_jobs (server_id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS streaming_stage_favorites (
      server_id TEXT NOT NULL, remote_id TEXT NOT NULL, favorite TEXT NOT NULL,
      PRIMARY KEY (server_id, remote_id))`);
};

/**
 * 开始磁盘暂存；临时表随数据库连接关闭释放，不占用整库内存
 * @param serverId - 服务器 ID
 */
export const resetStreamingStage = (serverId: string): void => {
  ensureStageTables();
  getDb().prepare("INSERT OR IGNORE INTO streaming_stage_jobs VALUES (?)").run(serverId);
  getDb().prepare("DELETE FROM streaming_stage WHERE server_id = ?").run(serverId);
};

/**
 * 记录同步期间的用户操作，避免迟到的分页覆盖刚确认的收藏状态
 * @param serverId - 服务器 ID
 * @param remoteId - 服务端歌曲 ID
 * @param favorite - 服务端确认的收藏状态
 */
export const recordStreamingStageFavorite = (
  serverId: string,
  remoteId: string,
  favorite: boolean,
): void => {
  ensureStageTables();
  getDb()
    .prepare(
      `INSERT INTO streaming_stage_favorites (server_id, remote_id, favorite)
    SELECT server_id, ?, ? FROM streaming_stage_jobs WHERE server_id = ?
    ON CONFLICT(server_id, remote_id) DO UPDATE SET favorite = excluded.favorite`,
    )
    .run(remoteId, JSON.stringify(favorite), serverId);
};

/**
 * 释放本次任务的全部暂存和收藏覆盖
 * @param serverId - 服务器 ID
 */
export const clearStreamingStage = (serverId: string): void => {
  ensureStageTables();
  for (const table of ["streaming_stage", "streaming_stage_jobs", "streaming_stage_favorites"])
    getDb().prepare(`DELETE FROM ${table} WHERE server_id = ?`).run(serverId);
};

/**
 * 暂存完整页，重复 ID 会中止本次同步
 * @param serverId - 服务器 ID
 * @param kind - 索引类型
 * @param entries - 分页数据
 */
export const stageStreamingPage = (serverId: string, kind: Kind, entries: Entry[]): void => {
  const insert = getDb().prepare("INSERT INTO streaming_stage VALUES (?, ?, ?, ?)");
  getDb().transaction(() => {
    for (const entry of entries) {
      const id = "source" in entry ? entry.originalId : entry.id;
      if (!id) throw new Error("服务器返回缺少 ID 的媒体条目");
      insert.run(serverId, kind, id, JSON.stringify(entry));
    }
  })();
};

/**
 * 所有索引成功后原子替换可见快照，失败时保留上一次媒体库
 * @param serverId - 服务器 ID
 */
export const publishStreamingStage = (serverId: string): void => {
  const previous = getDb()
    .prepare(
      `SELECT MAX(generation) AS generation FROM (
    SELECT MAX(generation) AS generation FROM remote_tracks WHERE server_id = ?
    UNION ALL SELECT MAX(generation) FROM remote_albums WHERE server_id = ?
    UNION ALL SELECT MAX(generation) FROM remote_artists WHERE server_id = ?
    UNION ALL SELECT MAX(generation) FROM remote_playlists WHERE server_id = ?)`,
    )
    .get(serverId, serverId, serverId, serverId) as { generation: number | null };
  const generation = Math.max(Date.now(), (previous.generation ?? 0) + 1);
  getDb().transaction(() => {
    for (const kind of ["songs", "albums", "artists", "playlists"] as const) {
      const select = getDb()
        .prepare(`SELECT s.remote_id, CASE WHEN s.kind = 'songs' AND f.favorite IS NOT NULL
        THEN json_set(s.data, '$.favorite', json(f.favorite)) ELSE s.data END AS data
        FROM streaming_stage s LEFT JOIN streaming_stage_favorites f
          ON f.server_id = s.server_id AND f.remote_id = s.remote_id
        WHERE s.server_id = ? AND s.kind = ? ORDER BY s.remote_id LIMIT 500 OFFSET ?`);
      let offset = 0;
      while (true) {
        const rows = select.all(serverId, kind, offset) as { remote_id: string; data: string }[];
        if (!rows.length) break;
        const records = rows.map((row) => ({
          serverId,
          remoteId: row.remote_id,
          generation,
          data: JSON.parse(row.data),
        }));
        if (kind === "songs")
          upsertTracks(records.map(({ data, ...base }) => ({ ...base, track: data as Track })));
        else if (kind === "albums")
          upsertAlbums(records.map(({ data, ...base }) => ({ ...base, album: data as Album })));
        else if (kind === "artists")
          upsertArtists(records.map(({ data, ...base }) => ({ ...base, artist: data as Artist })));
        else
          upsertPlaylists(
            records.map(({ data, ...base }) => ({ ...base, playlist: data as Playlist })),
          );
        offset += rows.length;
      }
    }
    deleteStaleTracks(serverId, generation);
    deleteStaleAlbums(serverId, generation);
    deleteStaleArtists(serverId, generation);
    deleteStalePlaylists(serverId, generation);
  })();
};
