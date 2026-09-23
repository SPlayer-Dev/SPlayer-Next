import type { Playlist } from "@shared/types/player";
import { getDb } from "@main/database";

export interface StreamingPlaylistRecord {
  serverId: string;
  remoteId: string;
  playlist: Playlist;
  generation: number;
}

interface PlaylistRow {
  data: string;
}

/**
 * 批量写入流媒体歌单
 * @param records - 流媒体歌单记录
 */
export const upsertPlaylists = (records: StreamingPlaylistRecord[]): void => {
  if (records.length === 0) return;
  const statement = getDb().prepare(`
    INSERT INTO remote_playlists (server_id, remote_id, data, name, generation, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id, remote_id) DO UPDATE SET
      data = excluded.data,
      name = excluded.name,
      generation = excluded.generation,
      updated_at = excluded.updated_at
  `);
  const now = Date.now();
  getDb().transaction(() => {
    for (const record of records) {
      statement.run(
        record.serverId,
        record.remoteId,
        JSON.stringify(record.playlist),
        record.playlist.name,
        record.generation,
        now,
      );
    }
  })();
};

/**
 * 获取指定服务器的完整歌单列表
 * @param serverId - 服务器 ID
 * @returns 完整歌单列表
 */
export const getPlaylists = (serverId: string): Playlist[] => {
  const rows = getDb()
    .prepare(
      "SELECT data FROM remote_playlists WHERE server_id = ? ORDER BY name COLLATE NOCASE, remote_id",
    )
    .all(serverId) as PlaylistRow[];
  return rows.map((row) => JSON.parse(row.data) as Playlist);
};

/**
 * 删除指定服务器的旧同步歌单
 * @param serverId - 服务器 ID
 * @param generation - 当前同步代次
 */
export const deleteStalePlaylists = (serverId: string, generation: number): void => {
  getDb()
    .prepare("DELETE FROM remote_playlists WHERE server_id = ? AND generation <> ?")
    .run(serverId, generation);
};

/**
 * 删除指定服务器的全部歌单
 * @param serverId - 服务器 ID
 */
export const deletePlaylistsByServer = (serverId: string): void => {
  getDb().prepare("DELETE FROM remote_playlists WHERE server_id = ?").run(serverId);
};
